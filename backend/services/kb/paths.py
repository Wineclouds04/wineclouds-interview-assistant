"""Portable path validation for files confined to the knowledge base."""
from pathlib import Path, PurePosixPath, PureWindowsPath


def safe_relative_path(value: str) -> Path:
    raw = (value or "").strip().replace("\\", "/")
    windows = PureWindowsPath(raw)
    posix = PurePosixPath(raw)
    if (
        not raw
        or "\x00" in raw
        or ":" in raw
        or windows.drive
        or windows.root
        or posix.is_absolute()
        or ".." in posix.parts
        or not posix.parts
    ):
        raise ValueError("invalid knowledge-base relative path")
    return Path(*posix.parts)


def resolve_kb_file_path(base_dir: Path, relative_path: str | Path) -> Path:
    base = Path(base_dir).resolve()
    relative = safe_relative_path(str(relative_path))
    target = base / relative
    resolved = target.resolve()
    if resolved == base or not resolved.is_relative_to(base):
        raise ValueError("knowledge-base path escapes its root")
    # Keep the lexical path so deleting an internal symlink deletes the link,
    # rather than the file it points to. External symlink targets are rejected.
    return target
