import pytest

from core import auth


@pytest.mark.parametrize(
    "host,expected",
    [
        ("127.0.0.1", True),
        ("127.8.9.1", True),
        ("::1", True),
        ("localhost", True),
        ("LOCALHOST ", True),
        ("192.168.1.10", False),
        ("10.0.0.1", False),
        ("evil.example", False),
        ("", False),
        (None, False),
    ],
)
def test_is_loopback_host(host, expected):
    assert auth.is_loopback_host(host) is expected


class TestOriginBypass:
    def test_no_origin_with_loopback_host_is_allowed(self):
        assert auth.origin_allows_loopback_bypass(None, "127.0.0.1", "http", 18080)

    def test_no_origin_with_foreign_host_is_rejected(self):
        # DNS rebinding: attacker's page is same-origin, sends no Origin, but Host is theirs.
        assert not auth.origin_allows_loopback_bypass(None, "evil.example", "http", 18080)

    def test_same_origin_loopback_is_allowed(self):
        assert auth.origin_allows_loopback_bypass(
            "http://localhost:18080", "localhost", "http", 18080
        )

    def test_loopback_origin_on_other_port_is_rejected(self):
        assert not auth.origin_allows_loopback_bypass(
            "http://localhost:5173", "localhost", "http", 18080
        )

    def test_foreign_origin_is_rejected(self):
        assert not auth.origin_allows_loopback_bypass(
            "http://evil.example:18080", "127.0.0.1", "http", 18080
        )

    def test_non_http_origin_is_rejected(self):
        assert not auth.origin_allows_loopback_bypass("file://", "127.0.0.1", "http", 18080)

    def test_null_origin_is_rejected(self):
        assert not auth.origin_allows_loopback_bypass("null", "127.0.0.1", "http", 18080)

    def test_default_ports(self):
        assert auth.origin_allows_loopback_bypass("http://127.0.0.1", "127.0.0.1", "http", None)
        assert not auth.origin_allows_loopback_bypass("https://127.0.0.1", "127.0.0.1", "http", None)


def test_loopback_bypass_requires_loopback_client():
    assert auth.loopback_bypass_allowed("127.0.0.1", None, "127.0.0.1", "http", 18080)
    assert not auth.loopback_bypass_allowed("192.168.1.2", None, "127.0.0.1", "http", 18080)


def test_auth_enabled_by_default(monkeypatch):
    monkeypatch.delenv("IA_AUTH_DISABLE", raising=False)
    monkeypatch.delenv("IA_AUTH_ENABLE", raising=False)
    monkeypatch.delenv("IA_AUTH_TOKEN", raising=False)
    assert auth.is_auth_disabled() is False


@pytest.mark.parametrize("value", ["1", "true", "YES", "on"])
def test_auth_can_be_disabled_explicitly(monkeypatch, value):
    monkeypatch.setenv("IA_AUTH_DISABLE", value)
    assert auth.is_auth_disabled() is True


def test_verify_token(monkeypatch):
    monkeypatch.setattr(auth, "_token", "secret-token")
    monkeypatch.setattr(auth, "_initialized", True)
    assert auth.verify_token("secret-token")
    assert auth.verify_token("  secret-token  ")
    assert not auth.verify_token("wrong")
    assert not auth.verify_token("")
    assert not auth.verify_token(None)


@pytest.mark.parametrize(
    "header,expected",
    [
        ("Bearer abc", "abc"),
        ("bearer   abc ", "abc"),
        ("Basic abc", None),
        ("Bearer", None),
        ("", None),
        (None, None),
    ],
)
def test_extract_token_from_headers(header, expected):
    assert auth.extract_token_from_headers(header) == expected


def test_redact_token_query():
    line = '127.0.0.1:5000 - "GET /ws?token=abc123&x=1 HTTP/1.1" 101'
    assert auth.redact_token_query(line) == '127.0.0.1:5000 - "GET /ws?token=***&x=1 HTTP/1.1" 101'
    assert auth.redact_token_query("/?t=zzz") == "/?t=***"
    assert auth.redact_token_query("/api/max_tokens=5") == "/api/max_tokens=5"
