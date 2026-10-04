"""Pipeline dispatch end to end, with the LLM answer worker replaced by a fake.

Exercises submit_answer_task → _try_dispatch → worker threads → ordered commit,
plus cancellation, without audio, STT or network.
"""
import random
import threading
import time

import pytest

from api.assist import pipeline
from core.config import AppConfig, ModelConfig


@pytest.fixture
def fake_pipeline(monkeypatch):
    cfg = AppConfig(
        models=[
            ModelConfig(name="a", api_key="sk-a", model="m-a"),
            ModelConfig(name="b", api_key="sk-b", model="m-b"),
        ],
        max_parallel_answers=2,
    )
    monkeypatch.setattr(pipeline, "get_config", lambda: cfg)
    monkeypatch.setattr(pipeline, "get_model_health", lambda idx: None)
    events: list[dict] = []
    monkeypatch.setattr(pipeline, "broadcast", events.append)

    committed: list[str] = []
    release = threading.Event()
    release.set()
    rng = random.Random(7)

    def fake_process(task, seq, model_idx, sess_v, deps):
        release.wait(5)
        time.sleep(rng.uniform(0, 0.02))
        if deps.abort_check():
            deps.mark_seq_skipped(seq)
            return
        deps.flush_commit(seq, lambda: committed.append(task[0]))

    monkeypatch.setattr(pipeline, "process_question_parallel", fake_process)
    pipeline.cancel_answer_work()
    yield committed, release, events
    release.set()
    pipeline.cancel_answer_work()


def _task(text):
    return (text, None, True, "manual", {"origin": "manual"})


def test_answers_commit_in_submission_order(fake_pipeline):
    committed, _, _ = fake_pipeline
    questions = [f"q{i}" for i in range(8)]
    for q in questions:
        assert pipeline.submit_answer_task(_task(q))
    assert pipeline._wait_for_answer_work_idle(5)
    assert committed == questions


def test_cancel_drops_in_flight_answers(fake_pipeline):
    committed, release, _ = fake_pipeline
    release.clear()
    for i in range(3):
        pipeline.submit_answer_task(_task(f"old{i}"))
    pipeline.cancel_answer_work()
    release.set()
    time.sleep(0.2)
    pipeline.submit_answer_task(_task("new"))
    assert pipeline._wait_for_answer_work_idle(5)
    assert committed == ["new"]


def test_submit_without_usable_model_reports_error(fake_pipeline, monkeypatch):
    _, _, events = fake_pipeline
    monkeypatch.setattr(
        pipeline, "get_config", lambda: AppConfig(models=[ModelConfig(name="x", api_key="")])
    )
    assert pipeline.submit_answer_task(_task("q")) is False
    assert events and events[-1]["type"] == "error"
