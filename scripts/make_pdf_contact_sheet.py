from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(r"D:\codex\interview-assistant")
PDFS = sorted((ROOT / "output" / "pdf" / "upload_ready").glob("*.pdf"))
RENDERS = sorted((ROOT / "tmp" / "pdfs" / "upload_ready_render").glob("page_*.png"))
OUTPUT = ROOT / "tmp" / "pdfs" / "upload_ready_contact_sheet.png"

if len(PDFS) != len(RENDERS):
    raise RuntimeError(f"PDF/render count mismatch: {len(PDFS)} vs {len(RENDERS)}")

columns = 4
card_width, card_height = 390, 540
rows = math.ceil(len(PDFS) / columns)
sheet = Image.new("RGB", (columns * card_width, rows * card_height), "#e9edf2")
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 16)

for index, (pdf, render) in enumerate(zip(PDFS, RENDERS), start=1):
    row, column = divmod(index - 1, columns)
    x, y = column * card_width, row * card_height
    with Image.open(render) as source:
        page = source.convert("RGB")
    page.thumbnail((350, 455), Image.Resampling.LANCZOS)
    page_x = x + (card_width - page.width) // 2
    page_y = y + 10
    sheet.paste(page, (page_x, page_y))
    draw.rectangle((page_x, page_y, page_x + page.width, page_y + page.height), outline="#6b7280")
    label = f"{index:02d}  {pdf.stem}"
    if len(label) > 34:
        label = label[:33] + "…"
    draw.text((x + 14, y + 492), label, font=font, fill="#111827")

sheet.save(OUTPUT, optimize=True)
print(OUTPUT)
