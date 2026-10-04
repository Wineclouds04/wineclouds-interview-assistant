import json

import pytest
from keyring.backend import KeyringBackend
from starlette.testclient import TestClient

from core import config as config_mod
from core import secret_store


class MemoryKeyring(KeyringBackend):
    priority = 1

    def __init__(self):
        super().__init__()
        self.store: dict[tuple[str, str], str] = {}

    def get_password(self, service, username):
        return self.store.get((service, username))

    def set_password(self, service, username, password):
        self.store[(service, username)] = password

    def delete_password(self, service, username):
        self.store.pop((service, username), None)


@pytest.fixture
def memory_keyring(monkeypatch):
    import keyring

    backend = MemoryKeyring()
    previous = keyring.get_keyring()
    keyring.set_keyring(backend)
    monkeypatch.delenv("IA_SECRET_STORE", raising=False)
    secret_store._reset_for_tests()
    yield backend
    keyring.set_keyring(previous)
    secret_store._reset_for_tests()


@pytest.fixture
def plaintext_store(monkeypatch):
    monkeypatch.setenv("IA_SECRET_STORE", "plaintext")
    secret_store._reset_for_tests()
    yield
    secret_store._reset_for_tests()


def _write(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


LEGACY = {
    "models": [{"name": "m1", "api_key": "sk-one"}, {"name": "m2", "api_key": ""}],
    "doubao_stt_api_key": "doubao-key",
    "ntfy_token": "tk_x",
}


def test_plaintext_secrets_migrate_into_keychain(tmp_config, memory_keyring):
    _write(tmp_config, LEGACY)
    cfg = config_mod.get_config()

    assert cfg.models[0].api_key == "sk-one"
    assert cfg.doubao_stt_api_key == "doubao-key"
    on_disk = _read(tmp_config)
    assert on_disk["models"][0]["api_key"].startswith("keyring:")
    assert on_disk["models"][1]["api_key"] == ""
    assert on_disk["doubao_stt_api_key"].startswith("keyring:")
    assert "sk-one" not in tmp_config.read_text(encoding="utf-8")
    assert sorted(memory_keyring.store.values()) == ["doubao-key", "sk-one", "tk_x"]


def test_references_resolve_on_reload(tmp_config, memory_keyring):
    _write(tmp_config, LEGACY)
    config_mod.get_config()
    config_mod._config = None
    secret_store._ref_by_value.clear()

    cfg = config_mod.get_config()
    assert cfg.models[0].api_key == "sk-one"
    assert cfg.ntfy_token == "tk_x"


def test_unchanged_secret_reuses_entry_and_changed_one_is_cleaned_up(tmp_config, memory_keyring):
    _write(tmp_config, LEGACY)
    config_mod.get_config()
    assert len(memory_keyring.store) == 3

    config_mod.update_config({"temperature": 0.9})
    assert len(memory_keyring.store) == 3

    config_mod.update_config({"doubao_stt_api_key": "new-key"})
    assert sorted(memory_keyring.store.values()) == ["new-key", "sk-one", "tk_x"]


def test_missing_keychain_entry_becomes_empty(tmp_config, memory_keyring):
    _write(tmp_config, {"doubao_stt_api_key": "keyring:does-not-exist"})
    assert config_mod.get_config().doubao_stt_api_key == ""


def test_plaintext_mode_keeps_file_format(tmp_config, plaintext_store):
    _write(tmp_config, LEGACY)
    config_mod.get_config()
    config_mod.update_config({"temperature": 0.9})
    assert _read(tmp_config)["models"][0]["api_key"] == "sk-one"


def test_plaintext_mode_migrates_references_back(tmp_config, memory_keyring, monkeypatch):
    _write(tmp_config, LEGACY)
    config_mod.get_config()
    config_mod._config = None

    monkeypatch.setenv("IA_SECRET_STORE", "plaintext")
    secret_store._backend_checked = False
    secret_store._backend = None
    config_mod.get_config()
    config_mod.update_config({"temperature": 0.7})
    assert _read(tmp_config)["models"][0]["api_key"] == "sk-one"


def test_save_is_atomic_and_leaves_no_temp_files(tmp_config, plaintext_store):
    config_mod.update_config({"temperature": 1.1})
    assert _read(tmp_config)["temperature"] == 1.1
    assert [p.name for p in tmp_config.parent.iterdir()] == ["config.json"]


def test_unreadable_keychain_blocks_save_and_recovers(tmp_config, memory_keyring, monkeypatch):
    import main

    _write(tmp_config, LEGACY)
    config_mod.get_config()
    saved = tmp_config.read_bytes()
    keys = dict(memory_keyring.store)
    original_read = memory_keyring.get_password

    def unavailable(*args):
        raise RuntimeError("temporarily locked")

    monkeypatch.setattr(memory_keyring, "get_password", unavailable)
    config_mod._config = None
    assert config_mod.get_config().models[0].api_key == ""
    with pytest.raises(config_mod.ConfigSaveError):
        config_mod.update_config({"temperature": 0.9})

    api = TestClient(main.app, client=("127.0.0.1", 1), base_url="http://127.0.0.1:18080")
    body = {"temperature": 0.9, "doubao_stt_api_key": "__IA_KEEP_EXISTING_SECRET__"}
    assert api.post("/api/config", json=body).status_code == 503
    assert api.post("/api/config/models-layout", json={"max_parallel_answers": 2}).status_code == 503
    assert tmp_config.read_bytes() == saved
    assert memory_keyring.store == keys

    monkeypatch.setattr(memory_keyring, "get_password", original_read)
    config_mod._secret_retry_at = 0.0
    assert api.post("/api/config", json=body).status_code == 200
    assert config_mod.get_config().doubao_stt_api_key == "doubao-key"
    assert memory_keyring.store == keys


@pytest.mark.parametrize("endpoint", ["/api/config", "/api/config/models-layout"])
def test_failed_disk_write_preserves_active_config_and_reports_503(tmp_config, plaintext_store, monkeypatch, endpoint):
    import main

    config_mod.update_config({"temperature": 0.7})
    original = config_mod.get_config()
    saved = tmp_config.read_bytes()

    def disk_full(*args):
        raise OSError("disk full")

    monkeypatch.setattr(config_mod, "_write_json_atomic", disk_full)
    with pytest.raises(config_mod.ConfigSaveError):
        config_mod.update_config({"temperature": 1.1})
    api = TestClient(main.app, client=("127.0.0.1", 1), base_url="http://127.0.0.1:18080")
    response = api.post(endpoint, json={"temperature": 1.1, "max_parallel_answers": 2})
    assert response.status_code == 503
    assert config_mod.get_config() is original
    assert config_mod.get_config().temperature == 0.7
    assert tmp_config.read_bytes() == saved


class TestConfigApi:
    @pytest.fixture
    def api(self, tmp_config, plaintext_store):
        import main

        _write(tmp_config, {
            "doubao_stt_access_token": "old-access",
            "doubao_stt_api_key": "old-key",
            "generic_stt_api_key": "",
        })
        return TestClient(main.app, client=("127.0.0.1", 1), base_url="http://127.0.0.1:18080")

    def test_get_config_never_returns_stt_secrets(self, api):
        body = api.get("/api/config").json()
        assert body["doubao_stt_access_token"] == ""
        assert body["doubao_stt_api_key"] == ""
        assert body["doubao_stt_access_token_set"] is True
        assert body["doubao_stt_api_key_set"] is True
        assert body["generic_stt_api_key_set"] is False
        assert "old-key" not in json.dumps(body)

    def test_keep_sentinel_preserves_saved_secret(self, api):
        r = api.post("/api/config", json={
            "doubao_stt_api_key": "__IA_KEEP_EXISTING_SECRET__",
            "doubao_stt_access_token": "new-access",
        })
        assert r.status_code == 200, r.text
        cfg = config_mod.get_config()
        assert cfg.doubao_stt_api_key == "old-key"
        assert cfg.doubao_stt_access_token == "new-access"
