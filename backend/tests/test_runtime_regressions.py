"""HTTP responsiveness, credential log redaction and launcher port propagation."""
import asyncio
from importlib import import_module
from importlib.util import module_from_spec, spec_from_file_location
from io import BytesIO, StringIO
import logging
from pathlib import Path
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from starlette.datastructures import UploadFile
from starlette.requests import Request
from uvicorn.logging import AccessFormatter

from core.logger import RedactTokenFilter


@pytest.mark.parametrize("operation", ["capture", "ask_screen", "asr_check", "kb_upload"])
def test_blocking_api_work_does_not_block_the_event_loop(tmp_path, monkeypatch, operation):
    from api.assist import routes as assist
    from api.kb import routes as kb
    review_router = import_module("api.review.router")
    from core.config import AppConfig
    from services import capture, review_analysis
    from services import llm

    entered, released = threading.Event(), threading.Event()

    def blocking(*args, **kwargs):
        entered.set()
        assert released.wait(1), "the API blocked its event loop"
        return {"ok": True} if operation == "asr_check" else "data:image/png;base64,FAKE"

    monkeypatch.setattr(capture, "capture_primary_left_half_data_url", blocking)
    monkeypatch.setattr(review_analysis, "run_asr_correction_check", blocking)
    monkeypatch.setattr(llm, "has_vision_model", lambda: True)
    monkeypatch.setattr(assist, "get_config", AppConfig)
    monkeypatch.setattr(assist, "pick_model_index", lambda *args: 0)
    monkeypatch.setattr(assist, "cancel_answer_work", Mock())
    monkeypatch.setattr(assist, "submit_answer_task", Mock(return_value=True))

    if operation == "capture":
        call = assist.api_capture_server_screen
    elif operation == "ask_screen":
        call = assist.api_ask_from_server_screen
    elif operation == "asr_check":
        call = lambda: review_router.test_asr_correction(review_router.AsrCorrectionTestRequest(answer="Answer"))
    else:
        original_write = kb._write_kb_upload

        def slow_write(*args):
            blocking()
            original_write(*args)

        async def low_priority(fn, *args):
            return fn(*args)

        monkeypatch.setattr(kb, "_write_kb_upload", slow_write)
        monkeypatch.setattr(kb, "_run_kb_low_priority", low_priority)
        monkeypatch.setattr(kb.indexer, "reindex_file", lambda *args: {})
        monkeypatch.setattr(kb, "get_config", lambda: SimpleNamespace(
            kb_dir=str(tmp_path), kb_file_extensions=[".txt"], kb_max_upload_bytes=1024,
        ))
        upload = UploadFile(BytesIO(b"knowledge"), filename="note.txt")
        call = lambda: kb.kb_upload(upload, "")

    async def heartbeat():
        while not entered.is_set():
            await asyncio.sleep(0)
        released.set()

    async def probe():
        results = await asyncio.wait_for(asyncio.gather(call(), heartbeat()), timeout=2)
        return results[0]

    result = asyncio.run(probe())
    assert result.get("ok", operation == "kb_upload")
    if operation == "kb_upload":
        assert (tmp_path / "note.txt").read_bytes() == b"knowledge"


@pytest.mark.parametrize("message,args", [
    ('%s - "WebSocket %s" [accepted]', ("127.0.0.1", "/ws?token=FAKE_SECRET&mode=assist")),
    ('connection rejected: %s', ("/ws?token=FAKE_SECRET",)),
    ('WebSocket /ws?t=FAKE_SECRET disconnected', ()),
    ('WebSocket %(path)s accepted', {"path": "/ws?token=FAKE_SECRET"}),
])
def test_url_tokens_are_redacted_without_breaking_log_format(message, args):
    record = logging.LogRecord("uvicorn.error", logging.INFO, __file__, 1, message, (args,) if isinstance(args, dict) else args, None)
    assert RedactTokenFilter().filter(record)
    formatted = record.getMessage()
    assert "FAKE_SECRET" not in formatted and "***" in formatted


def test_uvicorn_handshake_and_child_logger_output_are_redacted(monkeypatch):
    import main

    output = StringIO()
    handler = logging.StreamHandler(output)
    parent = logging.getLogger("uvicorn.error")
    monkeypatch.setattr(parent, "handlers", [handler])
    monkeypatch.setattr(parent, "filters", [])
    monkeypatch.setattr(parent, "level", logging.INFO)
    monkeypatch.setattr(parent, "propagate", False)
    child = logging.getLogger("uvicorn.error.regression_protocol")
    monkeypatch.setattr(child, "level", logging.NOTSET)
    monkeypatch.setattr(child, "propagate", True)
    for name in ("uvicorn", "uvicorn.access"):
        logger = logging.getLogger(name)
        monkeypatch.setattr(logger, "filters", list(logger.filters))
        for existing in logger.handlers:
            monkeypatch.setattr(existing, "filters", list(existing.filters))
    main._install_token_log_filters()
    main._install_token_log_filters()
    parent.info('%s - "WebSocket %s" [accepted]', "127.0.0.1", "/ws?token=FAKE_SECRET")
    child.warning("Rejected WebSocket %s", "/ws?t=FAKE_SECRET")
    assert "FAKE_SECRET" not in output.getvalue()
    assert output.getvalue().count("***") == 2
    assert sum(isinstance(f, RedactTokenFilter) for f in handler.filters) == 1


def test_redaction_preserves_uvicorn_access_formatter_arguments():
    args = ("127.0.0.1", "GET", "/ws?token=FAKE_SECRET", "1.1", 101)
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d', args, None)
    RedactTokenFilter().filter(record)
    formatter = AccessFormatter('%(client_addr)s %(request_line)s %(status_code)s', use_colors=False)
    text = formatter.format(record)
    assert "FAKE_SECRET" not in text and "101" in text and "GET /ws?token=*** HTTP/1.1" in text


def test_file_log_handlers_redact_tokens(tmp_path, monkeypatch):
    from core import logger

    monkeypatch.setattr(logger, "LOG_DIR", str(tmp_path))
    handler = logger._make_file_handler("isolated.log")
    try:
        record = logging.LogRecord("uvicorn.error", logging.ERROR, __file__, 1, "Rejected /ws?token=FAKE_SECRET", (), None)
        handler.handle(record)
        handler.flush()
        assert "FAKE_SECRET" not in (tmp_path / "isolated.log").read_text(encoding="utf-8")
    finally:
        handler.close()


def test_custom_launcher_port_matches_network_info(tmp_path, monkeypatch):
    import uvicorn
    router = import_module("api.common.router")

    root = Path(__file__).resolve().parents[2]
    spec = spec_from_file_location("regression_start", root / "start.py")
    launcher = module_from_spec(spec)
    spec.loader.exec_module(launcher)
    kill = Mock()
    run = Mock()
    monkeypatch.setattr(launcher, "kill_port", kill)
    monkeypatch.setattr(uvicorn, "run", run)
    monkeypatch.setenv("PORT", "18080")
    # start_server changes cwd; monkeypatch restores it when this test ends.
    monkeypatch.chdir(tmp_path)
    launcher.start_server("127.0.0.1", 19090)
    run.assert_called_once()
    assert run.call_args.kwargs["port"] == 19090
    kill.assert_called_once_with(19090)
    monkeypatch.setattr(router, "socket", SimpleNamespace(
        socket=Mock(side_effect=OSError("offline")),
        AF_INET=router.socket.AF_INET,
        SOCK_DGRAM=router.socket.SOCK_DGRAM,
    ))
    request = Request({
        "type": "http", "scheme": "http", "method": "GET", "path": "/api/network-info",
        "query_string": b"", "headers": [(b"host", b"localhost:19090")],
        "server": ("127.0.0.1", 19090), "client": ("127.0.0.1", 4321),
    })
    result = asyncio.run(router.api_network_info(request))
    assert result["port"] == 19090
    assert result["url"].startswith("http://127.0.0.1:19090")
