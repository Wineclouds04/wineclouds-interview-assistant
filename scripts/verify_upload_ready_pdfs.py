from __future__ import annotations

import sys
from pathlib import Path

import pymupdf


sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(r"D:\codex\interview-assistant")
PDF_DIR = ROOT / "output" / "pdf"
OUT_DIR = PDF_DIR / "upload_ready"
LIMIT = 18 * 1024 * 1024
EXPECTED_OUTPUT_COUNT = 27

SPLIT_COUNTS = {
    "二哥的_Java_进阶之路_暗黑知识库版.pdf": 2,
    "二哥的_Java_进阶之路_亮白知识库版.pdf": 2,
    "面渣逆袭_MySQL篇V2.2_知识库版.pdf": 4,
    "面渣逆袭_Redis篇V2.0_知识库版.pdf": 6,
    "面渣逆袭_Spring篇V2.0_知识库版.pdf": 4,
    "面渣逆袭_并发编程篇V2.1_知识库版.pdf": 2,
}


def document_stats(path: Path) -> tuple[int, int, int]:
    with pymupdf.open(path) as document:
        if document.needs_pass:
            raise RuntimeError(f"Password-protected output: {path.name}")
        page_count = document.page_count
        toc = document.get_toc(simple=True)
        if not toc:
            raise RuntimeError(f"Missing bookmarks: {path.name}")
        invalid_destinations = [item for item in toc if item[2] < 1 or item[2] > page_count]
        if invalid_destinations:
            raise RuntimeError(f"Invalid bookmark destination: {path.name}")

        sample_pages = sorted({0, page_count // 2, page_count - 1})
        sample_text = sum(len(document[index].get_text("text").strip()) for index in sample_pages)
        if sample_text == 0:
            sample_text = sum(len(page.get_text("text").strip()) for page in document)
        if sample_text == 0:
            raise RuntimeError(f"No searchable text layer detected: {path.name}")
        return page_count, len(toc), sample_text


def main() -> None:
    outputs = sorted(OUT_DIR.glob("*.pdf"))
    if len(outputs) != EXPECTED_OUTPUT_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_OUTPUT_COUNT} outputs, found {len(outputs)}")

    maximum = max(outputs, key=lambda path: path.stat().st_size)
    if maximum.stat().st_size >= LIMIT:
        raise RuntimeError(f"Largest output exceeds safety limit: {maximum.name}")

    stats = {path.name: document_stats(path) for path in outputs}
    for source in sorted(PDF_DIR.glob("*.pdf")):
        with pymupdf.open(source) as document:
            source_pages = document.page_count
        if source.name in SPLIT_COUNTS:
            parts = sorted(OUT_DIR.glob(f"{source.stem}_上传分卷_*.pdf"))
            if len(parts) != SPLIT_COUNTS[source.name]:
                raise RuntimeError(f"Wrong part count for {source.name}")
            output_pages = sum(stats[part.name][0] for part in parts)
            mapping = "+".join(str(stats[part.name][0]) for part in parts)
        else:
            output_pages = stats[source.name][0]
            mapping = str(output_pages)
        if output_pages != source_pages:
            raise RuntimeError(
                f"Page mismatch for {source.name}: source={source_pages}, output={output_pages}"
            )
        print(f"PASS\t{source.name}\t{mapping}={source_pages} pages")

    print(
        "SUMMARY\t"
        f"files={len(outputs)}\t"
        f"pages={sum(item[0] for item in stats.values())}\t"
        f"largest={maximum.name}\t"
        f"largest_mib={maximum.stat().st_size / 1024 / 1024:.2f}\t"
        "searchable_text=yes\tbookmarks=yes"
    )


if __name__ == "__main__":
    main()
