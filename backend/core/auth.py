"""LAN 访问鉴权模块。

设计目标:
1. 默认安全:鉴权始终开启,与启动方式 / 绑定地址无关。即使直接
   ``uvicorn main:app --host 0.0.0.0`` 启动,局域网请求也必须携带 token。
2. 本地无感:127.0.0.1 / ::1 / localhost 的同源请求直接放行,无需 token
   (Vite 开发代理会去掉 Origin 头,同样放行)。
3. 防 DNS rebinding:环回放行同时要求 Host 头是环回地址;Origin 存在时必须同源。
4. 可关闭(临时调试):设置环境变量 ``IA_AUTH_DISABLE=1`` 强制跳过鉴权。
   ``IA_AUTH_ENABLE`` 已无实际作用,仅为兼容旧脚本保留。
5. token 来源优先级:``IA_AUTH_TOKEN`` 环境变量 > 自动生成。
6. HTTP 请求只接受 ``Authorization: Bearer`` 头;``?token=`` 查询参数只用于
   WebSocket 握手(浏览器 WebSocket API 无法设置请求头),并在访问日志中脱敏。
"""
from __future__ import annotations

import ipaddress
import os
import re
import secrets
from typing import Optional
from urllib.parse import urlparse

_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}

_token: Optional[str] = None
_initialized = False


def _env_truthy(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in ("1", "true", "yes", "on")


def _resolve_token() -> str:
    env_token = (os.environ.get("IA_AUTH_TOKEN") or "").strip()
    if env_token:
        return env_token
    return secrets.token_urlsafe(24)


def init_auth() -> str:
    """Initialize auth token (idempotent). Returns the active token."""
    global _token, _initialized
    if not _initialized:
        _token = _resolve_token()
        _initialized = True
    return _token or ""


def get_token() -> str:
    if not _initialized:
        init_auth()
    return _token or ""


def is_auth_disabled() -> bool:
    return _env_truthy("IA_AUTH_DISABLE")


def is_loopback_host(host: Optional[str]) -> bool:
    """判断客户端 host 是否环回。

    安全默认:host 为空字符串 / None(无法识别客户端)时一律视为非环回,
    强制走鉴权路径,避免在反向代理 / 异常 ASGI 场景下绕过 LAN token。
    """
    if not host:
        return False
    h = host.strip().lower()
    if not h:
        return False
    if h in _LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return False


def _default_port_for_scheme(scheme: Optional[str]) -> int:
    return 443 if (scheme or "").lower() in ("https", "wss") else 80


def origin_allows_loopback_bypass(
    origin: Optional[str],
    request_host: Optional[str],
    request_scheme: str = "http",
    request_port: Optional[int] = None,
) -> bool:
    """Loopback auth bypass is only safe for non-browser or same-origin requests.

    The Host header must name a loopback address in every case: after a DNS
    rebinding attack a malicious page is "same-origin" with the backend and its
    GET requests carry no Origin header, but its Host is still the attacker's
    domain.
    """
    if not is_loopback_host(request_host):
        return False
    if not origin:
        # CLI/local service calls usually do not send Origin. Allow them only after
        # client_host has already been proven loopback by loopback_bypass_allowed().
        return True
    try:
        parsed = urlparse(origin)
        origin_port = parsed.port or _default_port_for_scheme(parsed.scheme)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    if not is_loopback_host(parsed.hostname):
        return False
    effective_request_port = request_port or _default_port_for_scheme(request_scheme)
    return origin_port == effective_request_port


def loopback_bypass_allowed(
    client_host: Optional[str],
    origin: Optional[str],
    request_host: Optional[str],
    request_scheme: str = "http",
    request_port: Optional[int] = None,
) -> bool:
    return is_loopback_host(client_host) and origin_allows_loopback_bypass(
        origin,
        request_host,
        request_scheme,
        request_port,
    )


def verify_token(candidate: Optional[str]) -> bool:
    if not candidate:
        return False
    expected = get_token()
    if not expected:
        return False
    return secrets.compare_digest(candidate.strip(), expected)


_TOKEN_QUERY_RE = re.compile(r"([?&](?:token|t)=)[^&\s\"']+")


def redact_token_query(text: str) -> str:
    """Mask ``token=`` / ``t=`` query values so they never reach log files."""
    return _TOKEN_QUERY_RE.sub(r"\1***", text)


def extract_token_from_headers(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None
