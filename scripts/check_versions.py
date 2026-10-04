#!/usr/bin/env python3
"""Fail if the app version differs between package manifests and the READMEs.

desktop/package.json is the source of truth (the README badge links to it).
Run from the repository root:  python scripts/check_versions.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    expected = json.loads((ROOT / "desktop/package.json").read_text(encoding="utf-8"))["version"]
    found = {
        "frontend/package.json": json.loads((ROOT / "frontend/package.json").read_text(encoding="utf-8"))["version"],
    }
    for readme in ("README.md", "README.en.md"):
        m = re.search(r"badge/version-v([0-9][^-\"]*)-", (ROOT / readme).read_text(encoding="utf-8"))
        found[readme] = m.group(1) if m else "<missing badge>"
    bad = {k: v for k, v in found.items() if v != expected}
    if bad:
        for k, v in bad.items():
            print(f"{k}: {v} (expected {expected} from desktop/package.json)")
        return 1
    print(f"version {expected} consistent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
