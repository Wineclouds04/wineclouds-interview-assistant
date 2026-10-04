"""Mutable answer-dispatch state for the assist pipeline.

``scheduler.py`` holds the pure scheduling rules.  This module owns the state
those rules operate on — the pending queue, in-flight tasks, ordered-commit
buffer, generation / session counters and ASR turn tracking — together with the
locks that guard it.  Previously these were thirteen module globals in
``pipeline.py`` mutated through ``global`` statements; keeping them on one
object makes every read/write go through a method that takes the right lock.

Locking rules:
- ``dispatch_lock`` and the commit lock are never held at the same time by this
  class.  Commit callbacks run *under* the commit lock, so a callback may read
  dispatch state, but nothing may take the commit lock while holding
  ``dispatch_lock``.
- The generation counter has its own lock and is never held with the others.
"""

from __future__ import annotations

import threading
from typing import Callable

from api.assist.scheduler import (
    PendingTask,
    TaskPayload,
    begin_asr_turn as scheduler_begin_asr_turn,
    drain_commit_queue,
)

ASR_TURN_WINDOW_SEC = 6.0


class AnswerDispatchState:
    def __init__(self) -> None:
        self._gen_lock = threading.Lock()
        self._generation = 0

        # Guards pending / in_flight / session_version / latest_asr_turn_id /
        # next_submit_seq / recent_asr_turn_monos. Exposed because the scheduler
        # helpers take the raw containers and must run under this lock.
        self.dispatch_lock = threading.Lock()
        self.pending: list[PendingTask] = []
        self.in_flight: dict[int, tuple[int, TaskPayload]] = {}
        self.session_version = 0
        self.latest_asr_turn_id = 0
        self.next_submit_seq = 0
        self.recent_asr_turn_monos: list[float] = []

        self._commit_lock = threading.Lock()
        self._commit_buffer: dict[int, Callable[[], None]] = {}
        self._skipped_commit_seqs: set[int] = set()
        self._next_commit_seq = 0

    # -- generation: bumped to abort every running answer --------------------

    def bump_generation(self) -> int:
        with self._gen_lock:
            self._generation += 1
            return self._generation

    def generation(self) -> int:
        with self._gen_lock:
            return self._generation

    # -- session / ASR turn ---------------------------------------------------

    def is_session_current(self, version: int) -> bool:
        # Lock-free on purpose: called from answer workers and commit callbacks.
        # A single int read is atomic, and a stale answer is re-checked at commit.
        return version == self.session_version

    def get_latest_asr_turn_id(self) -> int:
        with self.dispatch_lock:
            return self.latest_asr_turn_id

    def record_asr_turn(self, now_mono: float, window_sec: float = ASR_TURN_WINDOW_SEC) -> None:
        with self.dispatch_lock:
            self.recent_asr_turn_monos = [
                ts for ts in self.recent_asr_turn_monos if now_mono - ts <= window_sec
            ]
            self.recent_asr_turn_monos.append(now_mono)

    def begin_asr_turn(self, *, interrupt_pending_asr: bool) -> int:
        """Start a new ASR turn; superseded pending ASR tasks are skipped."""
        with self.dispatch_lock:
            self.latest_asr_turn_id, skipped = scheduler_begin_asr_turn(
                self.pending,
                self.latest_asr_turn_id,
                interrupt_pending_asr=interrupt_pending_asr,
            )
            turn_id = self.latest_asr_turn_id
        for seq in skipped:
            self.mark_seq_skipped(seq)
        return turn_id

    # -- queue ----------------------------------------------------------------

    def enqueue(self, task: TaskPayload) -> tuple[int, int]:
        """Append a task; returns (seq, session_version)."""
        with self.dispatch_lock:
            seq = self.next_submit_seq
            self.next_submit_seq += 1
            version = self.session_version
            self.pending.append((task, seq, version))
            return seq, version

    def release(self, seq: int) -> None:
        with self.dispatch_lock:
            self.in_flight.pop(seq, None)

    def reset_queue(self) -> int:
        """Drop queued/in-flight work and start a new session version.

        Returns the sequence number the commit buffer should resume from; pass
        it to :meth:`reset_commits`.  The two steps are separate because commit
        callbacks run under the commit lock and may take other pipeline locks,
        so callers must not hold e.g. the ASR state lock while resetting commits.
        """
        with self.dispatch_lock:
            self.pending.clear()
            self.in_flight.clear()
            self.latest_asr_turn_id = 0
            self.recent_asr_turn_monos = []
            self.session_version += 1
            return self.next_submit_seq

    def reset_commits(self, next_commit_seq: int) -> None:
        with self._commit_lock:
            self._commit_buffer.clear()
            self._skipped_commit_seqs.clear()
            self._next_commit_seq = next_commit_seq

    # -- ordered commit -------------------------------------------------------

    def flush_commit(self, seq: int, apply_fn: Callable[[], None]) -> None:
        """Buffer ``apply_fn`` and run every commit that is now in order."""
        with self._commit_lock:
            if seq < self._next_commit_seq:
                return
            self._commit_buffer[seq] = apply_fn
            self._drain_locked()

    def mark_seq_skipped(self, seq: int) -> None:
        with self._commit_lock:
            if seq < self._next_commit_seq:
                return
            self._skipped_commit_seqs.add(seq)
            self._drain_locked()

    def _drain_locked(self) -> None:
        self._next_commit_seq = drain_commit_queue(
            self._commit_buffer,
            self._skipped_commit_seqs,
            self._next_commit_seq,
        )

    # -- introspection --------------------------------------------------------

    def is_idle(self) -> bool:
        with self.dispatch_lock:
            busy = bool(self.pending) or bool(self.in_flight)
        with self._commit_lock:
            busy = busy or bool(self._commit_buffer)
        return not busy

    @property
    def next_commit_seq(self) -> int:
        with self._commit_lock:
            return self._next_commit_seq
