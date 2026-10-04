"""Shared SQLite connection setup for the storage modules.

Every database gets the same settings: WAL journaling, a busy timeout so
concurrent writers wait instead of failing with "database is locked", and
``sqlite3.Row`` rows.  Connections are short-lived and may be used from worker
threads, hence ``check_same_thread=False``.
"""
from __future__ import annotations

import sqlite3

BUSY_TIMEOUT_SEC = 10.0


def connect(
    path: str,
    *,
    foreign_keys: bool = False,
    timeout: float = BUSY_TIMEOUT_SEC,
) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=timeout, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(f"PRAGMA busy_timeout={int(timeout * 1000)}")
    if foreign_keys:
        conn.execute("PRAGMA foreign_keys=ON")
    return conn
