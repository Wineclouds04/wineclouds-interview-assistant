"""Test isolation: point config, databases and logs at a throwaway directory.

These environment variables must be set before any backend module is imported,
because the storage modules create their databases at import time.
"""
import os
import sys
import tempfile

_TMP = tempfile.mkdtemp(prefix="ia-tests-")
os.environ["IA_CONFIG_PATH"] = os.path.join(_TMP, "config.json")
os.environ["IA_DATA_DIR"] = os.path.join(_TMP, "data")
os.environ["IA_LOG_DIR"] = os.path.join(_TMP, "log")
os.environ["IA_SECRET_STORE"] = "plaintext"
for _var in ("IA_AUTH_DISABLE", "IA_AUTH_ENABLE", "IA_AUTH_TOKEN"):
    os.environ.pop(_var, None)

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import pytest  # noqa: E402
from services.storage import paths as storage_paths  # noqa: E402

# sqlite_path also checks this location for legacy database migration.
# Keep tests from copying any real databases into their temporary data dir.
storage_paths._BACKEND_ROOT = os.path.join(_TMP, "legacy")


@pytest.fixture
def tmp_config(tmp_path, monkeypatch):
    """Fresh, empty config file and in-memory config cache for one test."""
    from core import config as config_mod

    path = tmp_path / "config.json"
    monkeypatch.setattr(config_mod, "CONFIG_FILE", str(path))
    monkeypatch.setattr(config_mod, "_config", None)
    monkeypatch.setattr(config_mod, "_stored_secret_refs", set())
    monkeypatch.setattr(config_mod, "_unresolved_secret_refs", set())
    monkeypatch.setattr(config_mod, "_secret_retry_at", 0.0)
    yield path
    config_mod._config = None
