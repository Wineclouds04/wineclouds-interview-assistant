"""Failure recovery and session ownership; all provider calls are mocked."""
import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.session import Session
from services import memory, review_analysis, review_async_analysis, review_integration
from services.storage import review


@pytest.fixture
def review_db(tmp_path, monkeypatch):
    monkeypatch.setattr(review, "DB_PATH", str(tmp_path / "review.db"))
    monkeypatch.setattr(review_integration, "_current_review_session_id", None)
    review.init_db()
    return review


@pytest.fixture
def compaction_job(monkeypatch):
    jobs = []

    class DeferredThread:
        def __init__(self, target, **kwargs):
            self.target = target

        def start(self):
            jobs.append(self.target)

    monkeypatch.setattr(memory.threading, "Thread", DeferredThread)
    return jobs


def session_with_history():
    return Session(conversation_history=[{"role": "user", "content": str(i)} for i in range(14)])


@pytest.mark.parametrize("empty", [False, True])
def test_failed_or_empty_summary_preserves_history_and_allows_retry(monkeypatch, compaction_job, empty):
    target = session_with_history()
    original = deepcopy(target.conversation_history)
    summarize = Mock(return_value="" if empty else None)
    if not empty:
        summarize.side_effect = RuntimeError("provider timeout")
    monkeypatch.setattr(memory, "summarize_messages", summarize)
    memory.schedule_compaction(target)
    compaction_job.pop()()
    assert target.conversation_history == original
    assert target.system_summary == ""
    assert not target._compaction_running

    summarize.side_effect = None
    summarize.return_value = "Useful facts"
    memory.schedule_compaction(target)
    compaction_job.pop()()
    assert target.conversation_history == original[-4:]
    assert target.system_summary == "Useful facts"


def test_successful_compaction_keeps_messages_added_during_request(monkeypatch, compaction_job):
    target = session_with_history()
    original = deepcopy(target.conversation_history)
    monkeypatch.setattr(memory, "summarize_messages", lambda *args: "Facts")
    memory.schedule_compaction(target)
    target.conversation_history.append({"role": "user", "content": "new"})
    compaction_job.pop()()
    assert target.conversation_history == original[-4:] + [{"role": "user", "content": "new"}]


@pytest.mark.parametrize("reset", ["clear", "begin_interview"])
def test_old_compaction_cannot_write_into_a_new_conversation(monkeypatch, compaction_job, reset):
    target = session_with_history()
    monkeypatch.setattr(memory, "summarize_messages", lambda *args: "Stale facts")
    memory.schedule_compaction(target)
    getattr(target, reset)()
    target.conversation_history = [{"role": "user", "content": "fresh"}]
    target._compaction_running = True  # a different worker now owns this flag
    compaction_job.pop()()
    assert target.conversation_history == [{"role": "user", "content": "fresh"}]
    assert target.system_summary == ""
    assert target._compaction_running


@pytest.mark.parametrize("choices", [[], [SimpleNamespace(message=SimpleNamespace(content=" "))]])
def test_empty_model_response_is_a_compaction_failure(monkeypatch, choices):
    from services import llm

    create = Mock(return_value=SimpleNamespace(choices=choices, usage=None))
    monkeypatch.setattr(llm, "get_client", lambda: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    with pytest.raises(ValueError):
        memory.summarize_messages([{"role": "user", "content": "Keep this"}], "Old facts")


def test_each_review_archives_only_its_own_interview(review_db, monkeypatch):
    monkeypatch.setattr(review_integration, "get_config", lambda: SimpleNamespace(review_enabled=False))
    target = Session()
    first = review_integration.on_assist_start(None, None, False, True, session=target)
    target.add_qa("First interview", "Reference A", qa_id="a")
    target.add_candidate_transcription("Answer A", qa_id="a")
    target.conversation_history = [{"role": "user", "content": "Old context"}]
    target.system_summary = "Old facts"
    review_integration.on_assist_stop(target)

    second = review_integration.on_assist_start(None, None, False, True, session=target)
    assert target.get_last_qa() is None
    assert not target.conversation_history and not target.system_summary
    target.add_qa("Second interview", "Reference B", qa_id="b")
    target.add_candidate_transcription("Answer B", qa_id="b")
    review_integration.on_assist_stop(target)
    assert [qa.question for qa in target.qa_pairs] == ["First interview", "Second interview"]
    for sid, question, answer in [(first, "First interview", "Answer A"), (second, "Second interview", "Answer B")]:
        turns = review_db.get_session_detail(sid)["turns"]
        assert len(turns) == 1
        assert turns[0]["question_text"] == question
        assert turns[0]["candidate_answer_text"] == answer
        assert turns[0]["seq"] == 1


def test_new_interview_boundary_is_created_even_without_review(monkeypatch):
    target = Session()
    target.add_qa("Old", "Answer")
    previous = target.interview_id
    assert review_integration.on_assist_start(None, None, False, session=target) is None
    assert target.interview_id != previous and target.get_last_qa() is None


def test_interview_boundary_precedes_both_audio_workers(monkeypatch):
    from api.assist import pipeline
    from core.config import AppConfig
    import threading

    target = Session()
    previous = target.interview_id
    events = []

    class FakeThread:
        def __init__(self, **kwargs):
            pass

        def start(self):
            assert target.interview_id != previous
            events.append("candidate")

    def interviewer_start():
        assert target.interview_id != previous
        events.append("interviewer")

    def review_start(*args, **kwargs):
        kwargs["session"].begin_interview()
        events.append("boundary")

    monkeypatch.setattr(pipeline, "get_session", lambda: target)
    monkeypatch.setattr(pipeline, "get_config", lambda: AppConfig(candidate_asr_enabled=True))
    monkeypatch.setattr(pipeline, "stop_interview_loop", Mock())
    monkeypatch.setattr(pipeline, "_device_is_loopback", lambda *args: True)
    monkeypatch.setattr(pipeline, "audio_capture", Mock())
    monkeypatch.setattr(pipeline, "_candidate_audio_capture", Mock())
    monkeypatch.setattr(pipeline, "_threads", SimpleNamespace(candidate=None))
    monkeypatch.setattr(pipeline, "_stop_event", threading.Event())
    monkeypatch.setattr(pipeline, "_pause_event", threading.Event())
    monkeypatch.setattr(pipeline, "_candidate_flush_event", threading.Event())
    monkeypatch.setattr(pipeline, "broadcast", Mock())
    monkeypatch.setattr(pipeline.threading, "Thread", FakeThread)
    monkeypatch.setattr(pipeline, "_start_interview_worker_thread_if_needed", interviewer_start)
    monkeypatch.setattr(review_integration, "on_assist_start", review_start)
    pipeline.start_nonblocking(1, 2)
    assert events == ["boundary", "interviewer", "candidate"]


SUCCESS = {"strengths": ["Clear explanation"], "risks": [], "scorecard": {"accuracy": 8}}
SUMMARY = {"summary_markdown": "## Interview summary\nUseful feedback", "strong_points": [], "weak_points": []}


def make_review(db, count=1):
    sid = db.create_session(1.0, True, True)
    for i in range(count):
        db.add_turn(sid, f"qa-{i}", i + 1, f"Question {i}", "Candidate answer")
    db.end_session(sid, status="recorded")
    return sid


@pytest.mark.parametrize("failure", ["turn", "summary", "missing_key", "invalid_turn", "invalid_summary"])
def test_failed_review_can_retry_without_redoing_successful_turns(review_db, monkeypatch, failure):
    from api.review.router import trigger_review_analysis

    sid = make_review(review_db)
    analyze = Mock(return_value=deepcopy(SUCCESS))
    summary = Mock(return_value=deepcopy(SUMMARY))
    if failure == "turn":
        analyze.side_effect = RuntimeError("provider timeout")
    elif failure == "summary":
        summary.side_effect = RuntimeError("provider timeout")
    elif failure == "invalid_turn":
        analyze.return_value = {}
    elif failure == "invalid_summary":
        summary.return_value = {"summary_markdown": "## 总结生成失败\nError"}
    if failure == "missing_key":
        monkeypatch.setattr(review_analysis, "get_active_llm_client", Mock(side_effect=ValueError("Missing key")))
    else:
        monkeypatch.setattr(review_analysis, "analyze_turn", analyze)
    monkeypatch.setattr(review_analysis, "generate_summary", summary)
    review_async_analysis._analyze_session_worker(sid)
    detail = review_db.get_session_detail(sid)
    assert detail["status"] == "analysis_failed"
    assert not detail["summary_markdown"]
    saved_turn = detail["turns"][0]["analysis_status"] == "completed"

    # Exercise the real retry endpoint and the worker synchronously, without paid calls.
    monkeypatch.setattr(review_analysis, "analyze_turn", analyze)
    analyze.reset_mock(side_effect=True, return_value=True)
    analyze.return_value = deepcopy(SUCCESS)
    summary.side_effect = None
    summary.return_value = deepcopy(SUMMARY)
    monkeypatch.setattr(review_async_analysis, "analyze_session_async", review_async_analysis._analyze_session_worker)
    assert asyncio.run(trigger_review_analysis(sid))["status"] == "started"
    assert review_db.get_session_detail(sid)["status"] == "completed"
    assert analyze.call_count == (0 if saved_turn else 1)
    assert asyncio.run(trigger_review_analysis(sid))["status"] == "done"


def test_partial_turn_failure_does_not_create_a_misleading_summary(review_db, monkeypatch):
    sid = make_review(review_db, count=2)
    analyze = Mock(side_effect=[deepcopy(SUCCESS), RuntimeError("timeout")])
    summary = Mock(return_value=deepcopy(SUMMARY))
    monkeypatch.setattr(review_analysis, "analyze_turn", analyze)
    monkeypatch.setattr(review_analysis, "generate_summary", summary)
    review_async_analysis._analyze_session_worker(sid)
    detail = review_db.get_session_detail(sid)
    assert detail["status"] == "analysis_failed"
    assert [t["analysis_status"] for t in detail["turns"]] == ["completed", "failed"]
    summary.assert_not_called()


@pytest.mark.parametrize("summary,risks", [
    ("## 总结生成失败\nTimeout", []),
    ("Useful summary", ["分析失败: timeout"]),
    ("Useful summary", ["分析失败：timeout"]),
])
def test_old_error_reports_are_retryable(review_db, monkeypatch, summary, risks):
    from api.review.router import trigger_review_analysis

    sid = make_review(review_db)
    tid = review_db.get_session_detail(sid)["turns"][0]["id"]
    review_db.update_turn_analysis(tid, "completed", strengths=["Fact"], risks=risks)
    review_db.update_session_summary(sid, summary, [], [])
    review_db.update_session_status(sid, "completed")
    start = Mock()
    monkeypatch.setattr(review_async_analysis, "analyze_session_async", start)
    assert asyncio.run(trigger_review_analysis(sid))["status"] == "started"
    start.assert_called_once_with(sid)
