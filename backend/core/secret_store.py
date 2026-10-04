"""Keep API keys / tokens out of config.json by storing them in the OS keychain.

config.json only holds a reference such as ``"keyring:3f2c…"``; the real value
lives in Windows Credential Manager / macOS Keychain / Secret Service under the
service name ``interview-assistant``.

Behaviour:
- ``IA_SECRET_STORE=plaintext`` (or keyring missing / no usable backend) →
  secrets are written to config.json as before.  References that are already in
  the file are still resolved, so switching to plaintext is also the way to
  migrate back.
- Plain-text secrets found in an existing config.json are moved into the
  keychain on the next save.
"""
from __future__ import annotations

import os
import threading
import uuid
from typing import Any, Callable, Iterator, Optional

from core.logger import get_logger

logger = get_logger(__name__)

SERVICE = "interview-assistant"
REF_PREFIX = "keyring:"

# Top-level secret fields on AppConfig. Per-model ``api_key`` is handled separately.
TOP_LEVEL_SECRET_FIELDS = (
    "doubao_stt_access_token",
    "doubao_stt_api_key",
    "generic_stt_api_key",
    "ntfy_token",
)

_lock = threading.Lock()
# plaintext value -> reference id, so re-saving an unchanged secret reuses its entry.
_ref_by_value: dict[str, str] = {}
_backend_checked = False
_backend: Any = None


def _keyring() -> Any:
    """Return the keyring module if it has a usable backend, else None."""
    global _backend_checked, _backend
    if _backend_checked:
        return _backend
    _backend_checked = True
    if (os.environ.get("IA_SECRET_STORE") or "").strip().lower() == "plaintext":
        return None
    try:
        import keyring
        from keyring.backends import fail

        if isinstance(keyring.get_keyring(), fail.Keyring):
            logger.warning("No OS keychain backend available; API keys stay in config.json")
            return None
        _backend = keyring
    except Exception as e:
        logger.warning("keyring unavailable (%s); API keys stay in config.json", e)
    return _backend


def _reset_for_tests() -> None:
    global _backend_checked, _backend
    with _lock:
        _backend_checked = False
        _backend = None
        _ref_by_value.clear()


def _secret_slots(data: dict) -> Iterator[tuple[dict, str]]:
    """Yield (container, key) for every secret slot in a config dict."""
    for field in TOP_LEVEL_SECRET_FIELDS:
        if field in data:
            yield data, field
    for model in data.get("models") or []:
        if isinstance(model, dict) and "api_key" in model:
            yield model, "api_key"


def _map_slots(data: dict, fn: Callable[[str], str]) -> None:
    for container, key in _secret_slots(data):
        value = container.get(key)
        if isinstance(value, str) and value:
            container[key] = fn(value)


def resolve_secrets(data: dict, *, unresolved_refs: Optional[set[str]] = None) -> bool:
    """Replace ``keyring:<id>`` references with real values, in place.

    Returns True when the dict still contains plain-text secrets that should be
    migrated into the keychain on the next save.
    """
    kr = _keyring()
    needs_migration = False

    def resolve(value: str) -> str:
        nonlocal needs_migration
        if not value.startswith(REF_PREFIX):
            if kr is not None:
                needs_migration = True
            return value
        ref = value[len(REF_PREFIX):]
        secret: Optional[str] = None
        try:
            import keyring

            secret = keyring.get_password(SERVICE, ref)
        except Exception as e:
            logger.warning("Failed to read secret %s from keychain: %s", ref, e)
            if unresolved_refs is not None:
                unresolved_refs.add(ref)
            return ""
        if secret is None:
            logger.warning("Secret %s missing from keychain; please re-enter it in settings", ref)
            return ""
        with _lock:
            _ref_by_value[secret] = ref
        return secret

    _map_slots(data, resolve)
    return needs_migration


def store_secrets(data: dict) -> set[str]:
    """Move secrets from ``data`` into the keychain, leaving references, in place.

    Returns the set of references now in use.  Without a keychain, ``data`` is
    left as plain text and an empty set is returned.
    """
    kr = _keyring()
    if kr is None:
        return set()
    used: set[str] = set()

    def store(value: str) -> str:
        if value.startswith(REF_PREFIX):
            used.add(value[len(REF_PREFIX):])
            return value
        with _lock:
            ref = _ref_by_value.get(value)
        try:
            if ref is None:
                ref = uuid.uuid4().hex
                kr.set_password(SERVICE, ref, value)
                with _lock:
                    _ref_by_value[value] = ref
        except Exception as e:
            logger.warning("Failed to write secret to keychain, keeping it in config.json: %s", e)
            return value
        used.add(ref)
        return REF_PREFIX + ref

    _map_slots(data, store)
    return used


def delete_refs(refs: set[str]) -> None:
    """Remove keychain entries that config.json no longer references."""
    kr = _keyring()
    if kr is None or not refs:
        return
    for ref in refs:
        try:
            kr.delete_password(SERVICE, ref)
        except Exception:
            # Already gone or backend refused; a leftover entry is harmless.
            logger.debug("Could not delete stale keychain entry %s", ref)
    with _lock:
        for value, ref in list(_ref_by_value.items()):
            if ref in refs:
                del _ref_by_value[value]


def collect_refs(data: dict) -> set[str]:
    """Return the keychain references currently present in a raw config dict."""
    refs: set[str] = set()
    for container, key in _secret_slots(data):
        value = container.get(key)
        if isinstance(value, str) and value.startswith(REF_PREFIX):
            refs.add(value[len(REF_PREFIX):])
    return refs
