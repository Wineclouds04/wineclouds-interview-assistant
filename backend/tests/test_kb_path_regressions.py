"""Knowledge-base mutations must never reach a path outside their root."""
from pathlib import Path
import os
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import HTTPException
import pytest

from api.kb.routes import _safe_rel_path, _write_kb_upload
from services.kb import indexer
from services.kb.paths import resolve_kb_file_path, safe_relative_path


INVALID_PATHS = [
    "../outside.txt", "folder/../../outside.txt", r"..\outside.txt",
    "/outside.txt", r"\outside.txt", "C:outside.txt", r"C:\outside.txt",
    r"\\server\share\outside.txt", "file.txt:stream", "", ".", "\x00.txt",
]


@pytest.mark.parametrize("relative", INVALID_PATHS)
def test_invalid_paths_are_rejected_before_any_index_mutation(tmp_path, monkeypatch, relative):
    root = tmp_path / "kb"
    root.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("must survive", encoding="utf-8")
    store = Mock()
    monkeypatch.setattr(indexer, "get_config", lambda: SimpleNamespace(kb_dir=str(root)))
    monkeypatch.setattr(indexer, "_get_store", store)
    with pytest.raises(ValueError):
        resolve_kb_file_path(root, relative)
    for operation in [indexer.reindex_file, indexer.remove_file]:
        with pytest.raises(ValueError):
            operation(relative)
    store.assert_not_called()
    assert outside.read_text(encoding="utf-8") == "must survive"


@pytest.mark.parametrize("subdir,name", [
    ("", "C:outside.txt"), ("", "file.txt:stream"), ("C:folder", "safe.txt"),
    ("/absolute", "safe.txt"), (r"\absolute", "safe.txt"),
    ("../outside", "safe.txt"), (r"\\server\share", "safe.txt"),
])
def test_upload_rejects_absolute_drive_relative_and_traversal_paths(subdir, name):
    with pytest.raises(HTTPException) as error:
        _safe_rel_path(subdir, name, {".txt"})
    assert error.value.status_code == 400


def test_valid_nested_upload_and_delete_work(tmp_path, monkeypatch):
    relative = _safe_rel_path(r"nested\notes", "safe.txt", {".txt"})
    assert safe_relative_path(str(relative)) == Path("nested", "notes", "safe.txt")
    _write_kb_upload(tmp_path, relative, b"knowledge")
    assert (tmp_path / relative).read_bytes() == b"knowledge"
    store = Mock()
    monkeypatch.setattr(indexer, "get_config", lambda: SimpleNamespace(kb_dir=str(tmp_path)))
    monkeypatch.setattr(indexer, "_get_store", lambda: store)
    indexer.remove_file(relative.as_posix())
    store.delete_doc.assert_called_once_with(relative.as_posix())
    assert not (tmp_path / relative).exists()


def test_symlink_outside_kb_is_rejected(tmp_path, monkeypatch):
    root = tmp_path / "kb"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    file = outside / "keep.txt"
    file.write_bytes(b"keep")
    try:
        (root / "link").symlink_to(outside, target_is_directory=True)
    except OSError as error:
        if os.name != "nt":
            pytest.skip(f"Creating symlinks is not available: {error}")
        # Junctions need no symlink privilege and exercise Windows resolve().
        env = {**os.environ, "IA_TEST_JUNCTION": str(root / "link"), "IA_TEST_JUNCTION_TARGET": str(outside)}
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "$ErrorActionPreference = 'Stop'; New-Item -ItemType Junction -Path $env:IA_TEST_JUNCTION -Target $env:IA_TEST_JUNCTION_TARGET | Out-Null"],
            env=env, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if result.returncode:
            pytest.skip("This environment cannot create a symlink or directory junction")
    monkeypatch.setattr(indexer, "get_config", lambda: SimpleNamespace(kb_dir=str(root)))
    store = Mock()
    monkeypatch.setattr(indexer, "_get_store", store)
    for operation in [indexer.reindex_file, indexer.remove_file]:
        with pytest.raises(ValueError):
            operation("link/keep.txt")
    with pytest.raises(ValueError):
        _write_kb_upload(root, Path("link/keep.txt"), b"overwrite")
    store.assert_not_called()
    assert file.read_bytes() == b"keep"
