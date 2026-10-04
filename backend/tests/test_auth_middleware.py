"""End-to-end checks of the HTTP auth middleware and /api/auth/info.

The app is used without its lifespan (no ``with TestClient(...)``), so no audio,
STT or background workers start.
"""
import pytest
from starlette.testclient import TestClient

import main
from core import auth

TOKEN = "test-token-123"
LAN = ("192.168.1.50", 50000)
LOOPBACK = ("127.0.0.1", 50000)


@pytest.fixture(autouse=True)
def fixed_token(monkeypatch):
    monkeypatch.delenv("IA_AUTH_DISABLE", raising=False)
    monkeypatch.setattr(auth, "_token", TOKEN)
    monkeypatch.setattr(auth, "_initialized", True)


def client(addr, base_url="http://127.0.0.1:18080"):
    return TestClient(main.app, client=addr, base_url=base_url)


def test_lan_request_without_token_is_rejected():
    r = client(LAN).get("/api/options")
    assert r.status_code == 401


def test_lan_request_with_bearer_token_is_allowed():
    r = client(LAN).get("/api/options", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200


def test_lan_request_with_wrong_token_is_rejected():
    r = client(LAN).get("/api/options", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_query_token_is_not_accepted_for_http():
    r = client(LAN).get(f"/api/options?token={TOKEN}")
    assert r.status_code == 401


def test_loopback_same_origin_is_allowed_without_token():
    r = client(LOOPBACK).get("/api/options")
    assert r.status_code == 200


def test_loopback_with_foreign_host_header_is_rejected():
    # DNS rebinding: the TCP peer is loopback but the page lives on the attacker's domain.
    r = client(LOOPBACK, base_url="http://evil.example:18080").get("/api/options")
    assert r.status_code == 401


def test_loopback_cross_origin_is_rejected():
    r = client(LOOPBACK).get("/api/options", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 401


def test_auth_info_refuses_lan_client():
    r = client(LAN).get("/api/auth/info")
    # Reachable (not 401), but refuses to hand the token to a LAN client.
    assert r.status_code == 403


def test_auth_info_returns_token_to_loopback():
    r = client(LOOPBACK).get("/api/auth/info")
    assert r.status_code == 200
    assert r.json() == {"required": True, "token": TOKEN}


def test_auth_info_refuses_rebinding_page():
    r = client(LOOPBACK, base_url="http://evil.example:18080").get("/api/auth/info")
    assert r.status_code == 403


def test_explicit_disable_opens_lan_access(monkeypatch):
    monkeypatch.setenv("IA_AUTH_DISABLE", "1")
    assert client(LAN).get("/api/options").status_code == 200
    assert client(LOOPBACK).get("/api/auth/info").json() == {"required": False, "token": None}


def test_network_info_puts_token_in_fragment():
    r = client(LOOPBACK).get("/api/network-info")
    assert r.status_code == 200
    assert r.json()["url"].endswith(f"/#t={TOKEN}")


def test_websocket_requires_token_from_lan():
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client(LAN).websocket_connect("/ws"):
            pass
