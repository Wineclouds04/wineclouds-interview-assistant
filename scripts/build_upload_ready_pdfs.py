from __future__ import annotations

import math
import os
import shutil
from pathlib import Path

import pymupdf


ROOT = Path(r"D:\codex\interview-assistant")
PDF_DIR = ROOT / "output" / "pdf"
OUT_DIR = PDF_DIR / "upload_ready"
STAGING_DIR = ROOT / "tmp" / "pdfs" / "upload_ready_staging"

# The target service rejects files larger than 20 MiB. Keep a 2 MiB margin.
TARGET_LIMIT = 18 * 1024 * 1024
PLATFORM_LIMIT = 20 * 1024 * 1024

SPLIT_COUNTS = {
    "二哥的_Java_进阶之路_暗黑知识库版.pdf": 2,
    "二哥的_Java_进阶之路_亮白知识库版.pdf": 2,
    "面渣逆袭_MySQL篇V2.2_知识库版.pdf": 4,
    "面渣逆袭_Redis篇V2.0_知识库版.pdf": 6,
    "面渣逆袭_Spring篇V2.0_知识库版.pdf": 4,
    "面渣逆袭_并发编程篇V2.1_知识库版.pdf": 2,
}

EXPECTED_SOURCE_COUNT = 13
EXPECTED_OUTPUT_COUNT = 27


def page_ranges(page_count: int, part_count: int) -> list[tuple[int, int]]:
    """Return balanced inclusive, zero-based page ranges."""
    boundaries = [math.floor(page_count * index / part_count) for index in range(part_count + 1)]
    return [(boundaries[index], boundaries[index + 1] - 1) for index in range(part_count)]


def part_toc(
    source_toc: list[list], start_page: int, end_page: int, part_number: int, part_count: int
) -> list[list]:
    """Preserve source bookmarks beneath a synthetic per-volume root bookmark."""
    toc = [[1, f"第 {part_number} 卷（共 {part_count} 卷）", 1]]
    previous_level = 1
    for item in source_toc:
        level, title, page_number, *rest = item
        if page_number < start_page + 1 or page_number > end_page + 1:
            continue
        # Nest original top-level entries below the synthetic volume root.
        adjusted_level = max(2, int(level) + 1)
        adjusted_level = min(adjusted_level, previous_level + 1)
        adjusted_page = int(page_number) - start_page
        toc.append([adjusted_level, str(title), adjusted_page])
        previous_level = adjusted_level
    return toc


def split_pdf(source_path: Path, part_count: int) -> list[Path]:
    results: list[Path] = []
    with pymupdf.open(source_path) as source:
        source_toc = source.get_toc(simple=True)
        metadata = dict(source.metadata or {})
        ranges = page_ranges(source.page_count, part_count)

        for part_number, (start_page, end_page) in enumerate(ranges, start=1):
            destination_name = (
                f"{source_path.stem}_上传分卷_{part_number:02d}-of-{part_count:02d}.pdf"
            )
            destination = OUT_DIR / destination_name
            staging = STAGING_DIR / f"{destination_name}.partial"

            document = pymupdf.open()
            document.insert_pdf(
                source,
                from_page=start_page,
                to_page=end_page,
                links=True,
                annots=True,
                widgets=True,
            )
            part_metadata = dict(metadata)
            base_title = metadata.get("title") or source_path.stem
            part_metadata["title"] = f"{base_title}（第 {part_number} 卷，共 {part_count} 卷）"
            part_metadata["subject"] = (
                f"知识库上传分卷；原 PDF 第 {start_page + 1}–{end_page + 1} 页"
            )
            document.set_metadata(part_metadata)
            document.set_toc(
                part_toc(source_toc, start_page, end_page, part_number, part_count)
            )
            document.save(
                staging,
                garbage=4,
                clean=True,
                deflate=True,
                deflate_images=True,
                deflate_fonts=True,
                use_objstms=1,
                compression_effort=100,
                reproducible=True,
            )
            document.close()
            os.replace(staging, destination)
            results.append(destination)
    return results


def copy_small_pdf(source_path: Path) -> Path:
    destination = OUT_DIR / source_path.name
    temporary = STAGING_DIR / f"{source_path.name}.partial"
    shutil.copy2(source_path, temporary)
    os.replace(temporary, destination)
    return destination


def validate_output(outputs: list[Path]) -> None:
    if len(outputs) != EXPECTED_OUTPUT_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_OUTPUT_COUNT} PDFs, generated {len(outputs)}")

    oversized: list[str] = []
    for path in outputs:
        size = path.stat().st_size
        if size >= TARGET_LIMIT:
            oversized.append(f"{path.name}: {size / 1024 / 1024:.2f} MiB")
        with pymupdf.open(path) as document:
            if document.page_count < 1:
                raise RuntimeError(f"Empty PDF: {path.name}")
            if not document.get_toc(simple=True):
                raise RuntimeError(f"Missing bookmarks: {path.name}")

    if oversized:
        raise RuntimeError(
            "One or more outputs exceeded the 18 MiB safety target:\n" + "\n".join(oversized)
        )


def main() -> None:
    sources = sorted(PDF_DIR.glob("*.pdf"))
    if len(sources) != EXPECTED_SOURCE_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_SOURCE_COUNT} source PDFs, found {len(sources)}")
    missing = set(SPLIT_COUNTS) - {source.name for source in sources}
    if missing:
        raise RuntimeError(f"Missing source PDFs: {sorted(missing)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STAGING_DIR.mkdir(parents=True, exist_ok=True)

    outputs: list[Path] = []
    for source in sources:
        if source.name in SPLIT_COUNTS:
            outputs.extend(split_pdf(source, SPLIT_COUNTS[source.name]))
        else:
            if source.stat().st_size >= PLATFORM_LIMIT:
                raise RuntimeError(f"Unconfigured oversized PDF: {source.name}")
            outputs.append(copy_small_pdf(source))

    validate_output(outputs)
    print(f"Generated {len(outputs)} upload-ready PDFs in {OUT_DIR}")
    for path in sorted(outputs):
        print(f"{path.name}\t{path.stat().st_size / 1024 / 1024:.2f} MiB")


if __name__ == "__main__":
    main()
