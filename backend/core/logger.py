"""Centralized logging configuration.

Log files are written to <project_root>/log/ with daily rotation. Old files are
deleted after ``IA_LOG_RETENTION_DAYS`` days (default 30; interview.log holds
transcripts, so shorten this if that matters to you).
- interview.log  — transcription, answer, pipeline events
- error.log      — ERROR+ from all modules
- app.log        — general application log (INFO+)

Usage in any module:
    from core.logger import get_logger
    logger = get_logger(__name__)
"""

import logging
import os
import sys
from logging.handlers import TimedRotatingFileHandler

from core.env import env_int
from core.auth import redact_token_query

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROJECT_ROOT = os.path.dirname(_BACKEND_DIR)
LOG_DIR = os.environ.get("IA_LOG_DIR") or os.path.join(_PROJECT_ROOT, "log")

_LOG_FORMAT = "%(asctime)s | %(levelname)-5s | %(name)s | %(message)s"
_LOG_DATE_FMT = "%Y-%m-%d %H:%M:%S"

_initialized = False


class RedactTokenFilter(logging.Filter):
    """Redact URL credentials without changing access-log argument structure."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_token_query(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(redact_token_query(a) if isinstance(a, str) else a for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {
                key: redact_token_query(value) if isinstance(value, str) else value
                for key, value in record.args.items()
            }
        return True


def _ensure_log_dir():
    os.makedirs(LOG_DIR, exist_ok=True)


def _make_file_handler(
    filename: str,
    level: int = logging.DEBUG,
    when: str = "midnight",
    backup_count: int | None = None,
) -> TimedRotatingFileHandler:
    if backup_count is None:
        backup_count = env_int("IA_LOG_RETENTION_DAYS", 30, minimum=1)
    path = os.path.join(LOG_DIR, filename)
    handler = TimedRotatingFileHandler(
        path, when=when, backupCount=backup_count, encoding="utf-8"
    )
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_LOG_DATE_FMT))
    handler.addFilter(RedactTokenFilter())
    handler.suffix = "%Y-%m-%d"
    return handler


def setup_logging():
    """Call once at application startup (idempotent)."""
    global _initialized
    if _initialized:
        return
    _initialized = True

    _ensure_log_dir()

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    # --- interview.log: transcription / answer / pipeline ---
    interview_handler = _make_file_handler("interview.log", logging.DEBUG)
    logging.getLogger("interview").addHandler(interview_handler)
    logging.getLogger("interview").setLevel(logging.DEBUG)
    logging.getLogger("interview").propagate = False

    # --- error.log: ERROR+ from all modules ---
    error_handler = _make_file_handler("error.log", logging.ERROR)
    root.addHandler(error_handler)

    # --- app.log: general INFO+ ---
    app_handler = _make_file_handler("app.log", logging.INFO)
    root.addHandler(app_handler)

    # --- console: keep existing uvicorn style, WARNING+ for our code ---
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers if not isinstance(h, TimedRotatingFileHandler)):
        console = logging.StreamHandler(sys.stderr)
        console.setLevel(logging.WARNING)
        console.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_LOG_DATE_FMT))
        console.addFilter(RedactTokenFilter())
        root.addHandler(console)


def get_logger(name: str) -> logging.Logger:
    """Return a module-level logger. Call setup_logging() once before using."""
    return logging.getLogger(name)


def get_interview_logger() -> logging.Logger:
    """Dedicated logger for interview events (transcription, answer, pipeline)."""
    return logging.getLogger("interview")
