"""Drive the real candidate loop/VAD with synthetic audio and fake devices."""
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from api.assist import candidate
from core.config import AppConfig
from core.session import Session
from services.audio import VADBuffer
from services.stt import factory


@pytest.fixture
def candidate_env(monkeypatch):
    session = Session()
    session.add_qa("First question", "Reference", qa_id="first")
    session.open_candidate_answer_window("first")
    cfg = AppConfig(candidate_asr_enabled=True, candidate_streaming_asr_enabled=False, silence_duration=0.65)
    stop = threading.Event()
    monkeypatch.setattr(candidate, "get_config", lambda: cfg)
    monkeypatch.setattr(candidate, "get_session", lambda: session)
    monkeypatch.setattr(candidate, "_stop_event", stop)
    monkeypatch.setattr(candidate, "_pause_event", threading.Event())
    monkeypatch.setattr(candidate, "_candidate_flush_event", threading.Event())
    monkeypatch.setattr(candidate, "_preload_candidate_whisper_async", Mock())
    monkeypatch.setattr(candidate, "_submit_candidate_knowledge_update", Mock())
    monkeypatch.setattr(candidate, "broadcast", Mock())
    monkeypatch.setattr(candidate, "postprocess_interview_transcription", lambda text: text)
    monkeypatch.setattr(candidate, "transcription_for_publish", lambda text, *_: text)
    return session, stop


class BatchCapture:
    def __init__(self, stop, batches, on_batch=None):
        self.stop_event = stop
        self.batches = list(batches)
        self.count = 0
        self.on_batch = on_batch
        self.stopped = False

    def drain_audio_chunks(self, **kwargs):
        self.count += 1
        if self.on_batch:
            self.on_batch(self.count)
        if self.batches:
            return self.batches.pop(0)
        self.stop_event.set()
        return []

    def stop(self, **kwargs):
        self.stopped = True


def chunks(audio):
    return [audio[i:i + 4000] for i in range(0, len(audio), 4000)]


def test_all_vad_flushes_in_one_batch_are_transcribed(candidate_env, monkeypatch):
    session, stop = candidate_env
    prior = np.full(12800, 0.1, dtype=np.float32)
    batch = np.concatenate([
        np.zeros(10560, dtype=np.float32),
        np.full(2560, 0.2, dtype=np.float32),
        np.zeros(10560, dtype=np.float32),
    ])
    flushes, transcribed = [], []

    class TrackingVAD(VADBuffer):
        def feed(self, audio):
            result = super().feed(audio)
            if result is not None:
                flushes.append(float(np.max(result)))
            return result

    def transcribe(audio, *args, **kwargs):
        transcribed.append(float(np.max(audio)))
        return f"Candidate segment {len(transcribed)}"

    capture = BatchCapture(stop, [chunks(prior), chunks(batch)])
    monkeypatch.setattr(candidate, "_candidate_audio_capture", capture)
    monkeypatch.setattr(candidate, "VADBuffer", TrackingVAD)
    monkeypatch.setattr(candidate, "transcribe_with_fallback", transcribe)
    candidate._candidate_worker()
    assert len(flushes) == 2
    assert transcribed == flushes
    assert len(session.candidate_answer_segments) == 2
    assert len({s.segment_id for s in session.candidate_answer_segments}) == 2
    assert capture.stopped and not session.candidate_asr_busy


def test_final_audio_waits_for_busy_whisper_and_is_not_dropped(candidate_env, monkeypatch):
    session, stop = candidate_env
    voice = np.ones(16000, dtype=np.float32) * 0.1
    capture = BatchCapture(stop, [chunks(voice)])
    monkeypatch.setattr(candidate, "_candidate_audio_capture", capture)
    engine = SimpleNamespace(is_loaded=True, model_size="fake", transcribe=Mock(return_value="Retained final answer"))
    monkeypatch.setattr(factory, "get_stt_engine", lambda **kwargs: engine)
    infer_lock = threading.Lock()
    infer_lock.acquire()
    monkeypatch.setattr(factory, "_whisper_infer_lock", infer_lock)
    entered, finished = threading.Event(), threading.Event()

    def transcribe(*args, **kwargs):
        entered.set()
        return factory.transcribe_with_fallback(*args, **kwargs)

    def worker():
        try:
            candidate._candidate_worker()
        finally:
            finished.set()

    monkeypatch.setattr(candidate, "transcribe_with_fallback", transcribe)
    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    try:
        assert entered.wait(2)
        assert not finished.wait(0.05)
        engine.transcribe.assert_not_called()
    finally:
        infer_lock.release()
        stop.set()
        thread.join(2)
    assert not thread.is_alive()
    engine.transcribe.assert_called_once()
    assert session.get_candidate_answer_for_qa("first") == "Retained final answer"


@pytest.mark.parametrize("original_qa", ["first", ""])
def test_segment_keeps_the_question_it_started_under(candidate_env, monkeypatch, original_qa):
    session, stop = candidate_env
    session.open_candidate_answer_window(original_qa)
    voice = np.full(12800, 0.1, dtype=np.float32)
    silence = np.zeros(11000, dtype=np.float32)

    def next_question(batch_number):
        if batch_number == 2:
            session.add_qa("Second question", "Reference", qa_id="second")
            session.open_candidate_answer_window("second")

    capture = BatchCapture(stop, [chunks(voice), chunks(silence)], next_question)
    monkeypatch.setattr(candidate, "_candidate_audio_capture", capture)
    monkeypatch.setattr(candidate, "transcribe_with_fallback", lambda *args, **kwargs: "Answer to first question")
    candidate._candidate_worker()
    assert session.candidate_answer_segments[0].qa_id == original_qa
    assert session.get_candidate_answer_for_qa("first") == ("Answer to first question" if original_qa else "")
    assert session.get_candidate_answer_for_qa("second") == ""


def test_old_worker_cannot_publish_or_stop_a_new_interview(candidate_env, monkeypatch):
    session, stop = candidate_env
    capture = BatchCapture(stop, [chunks(np.ones(16000, dtype=np.float32) * 0.1)])
    monkeypatch.setattr(candidate, "_candidate_audio_capture", capture)

    def transcribe(*args, **kwargs):
        session.begin_interview()
        session.add_qa("New interview", "Reference", qa_id="new")
        session.open_candidate_answer_window("new")
        return "Stale answer"

    monkeypatch.setattr(candidate, "transcribe_with_fallback", transcribe)
    candidate._candidate_worker()
    assert not session.candidate_answer_segments
    assert not session.candidate_asr_busy
    assert not capture.stopped
