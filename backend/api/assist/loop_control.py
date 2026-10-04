"""Primitives shared by the interviewer loop and the candidate-mic worker."""

import threading

import numpy as np

# stop: set by stop_interview_loop(); every worker loop exits when it sees it.
# pause: set while the interview is paused; workers idle without capturing.
_stop_event = threading.Event()
_pause_event = threading.Event()
_vad_feed_chunk_samples = 320


def _stop_capture_compat(capture, *, owner: str, clear_queue: bool) -> None:
    try:
        capture.stop(owner=owner, clear_queue=clear_queue)
    except TypeError:
        capture.stop(owner=owner)


def _iter_vad_feed_chunks(audio_chunk: np.ndarray):
    frame = max(1, int(_vad_feed_chunk_samples))
    total = len(audio_chunk)
    for start in range(0, total, frame):
        yield audio_chunk[start:start + frame]
