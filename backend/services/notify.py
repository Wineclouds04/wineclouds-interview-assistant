from __future__ import annotations

from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from core.background import BoundedTaskWorker
from core.config import get_config
from core.logger import get_logger


logger = get_logger(__name__)


class PhonePushError(RuntimeError):
    """Raised when an ntfy notification cannot be delivered."""


@dataclass(frozen=True)
class NtfyConfig:
    enabled: bool = False
    server_url: str = "https://ntfy.sh"
    topic: str = ""
    token: str = ""


def publish_ntfy(
    config: NtfyConfig,
    message: str,
    *,
    title: str = "Interview Assistant",
    timeout: float = 10.0,
) -> bool:
    """Publish one UTF-8 message to ntfy; return False when disabled."""
    if not config.enabled:
        return False

    server_url = config.server_url.strip().rstrip("/")
    topic = config.topic.strip()
    if not server_url:
        raise PhonePushError("ntfy 服务器地址不能为空")
    if not topic:
        raise PhonePushError("ntfy Topic 不能为空")
    parsed = urlparse(server_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise PhonePushError("ntfy 服务器地址无效，应以 http:// 或 https:// 开头")

    body = message.strip()
    if not body:
        raise PhonePushError("回答为空，无法推送到手机")

    headers = {
        "Content-Type": "text/plain; charset=utf-8",
        # urllib encodes HTTP headers as latin-1, so keep this header ASCII.
        # Chinese question/answer text remains UTF-8 in the request body.
        "Title": title.strip() or "Interview Assistant",
        "Priority": "high",
    }
    token = config.token.strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        f"{server_url}/{quote(topic, safe='')}",
        data=body.encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urlopen(request, timeout=timeout):
            pass
    except HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace").strip()
        except Exception:
            detail = ""
        suffix = f"：{detail[:160]}" if detail else ""
        raise PhonePushError(f"ntfy 返回 HTTP {exc.code}{suffix}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", None) or str(exc)
        raise PhonePushError(f"无法连接 ntfy：{reason}") from exc
    return True


def ntfy_config_from_app(cfg=None, *, force_enabled: bool = False) -> NtfyConfig:
    app_cfg = cfg or get_config()
    return NtfyConfig(
        enabled=force_enabled or bool(getattr(app_cfg, "ntfy_enabled", False)),
        server_url=str(getattr(app_cfg, "ntfy_server_url", "https://ntfy.sh") or ""),
        topic=str(getattr(app_cfg, "ntfy_topic", "") or ""),
        token=str(getattr(app_cfg, "ntfy_token", "") or ""),
    )


def _broadcast_status(payload: dict) -> None:
    try:
        from api.realtime.ws import broadcast

        broadcast(payload)
    except Exception:
        logger.debug("failed to broadcast ntfy status", exc_info=True)


def _push_answer(config: NtfyConfig, question: str, answer: str, model_name: str) -> None:
    title = "Interview Answer"
    model_line = f"模型：{model_name.strip()}\n\n" if model_name.strip() else ""
    message = f"{model_line}问题：{question.strip()}\n\n回答：{answer.strip()}"
    try:
        publish_ntfy(config, message, title=title)
    except PhonePushError as exc:
        logger.warning("NTFY_PUSH_FAIL: %s", exc)
        _broadcast_status({"type": "ntfy_status", "ok": False, "message": str(exc)})
        return
    logger.info("NTFY_PUSH_OK topic=%s answer_len=%d", config.topic, len(answer))
    _broadcast_status({"type": "ntfy_status", "ok": True})


_answer_push_worker = BoundedTaskWorker("ntfy-answer-push", _push_answer, maxsize=16)


def submit_answer_notification(question: str, answer: str, model_name: str = "") -> bool:
    """Queue a completed answer without blocking answer delivery or persistence."""
    try:
        config = ntfy_config_from_app()
        if not config.enabled:
            return False
        queued = _answer_push_worker.submit(config, question, answer, model_name)
        if not queued:
            logger.warning("NTFY_PUSH_DROP queue_full=true")
            _broadcast_status({"type": "ntfy_status", "ok": False, "message": "推送队列已满"})
        return queued
    except Exception:
        # Phone delivery is best-effort and must never turn a persisted answer
        # into an answer_error event.
        logger.warning("NTFY_PUSH_ENQUEUE_FAIL", exc_info=True)
        return False
