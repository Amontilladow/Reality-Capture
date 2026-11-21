"""
Regenerates the PDF fixtures checked into this directory. NOT part of the
test suite and not run by pytest -- it needs reportlab, which is a
fixture-authoring tool only, never a runtime or test dependency of this
service (kept out of requirements*.txt on purpose). Run by hand only when
a fixture genuinely needs to change:

    pip install reportlab pypdfium2 Pillow
    python generate_fixtures.py

Four fixtures, each reproducing a documented real failure pattern from
this engagement:

1. native_bottom_right.pdf -- a native-text page with a bordered grid
   title block in the bottom-right corner (the most common real layout),
   a labeled drawing-number/revision/title, plus a small, separate
   revision-history mini-table elsewhere on the page (the "Rev. | Date |
   Reason For Issue" shape that previously produced a false revision
   match of "Date" -- see title-block-extractor.ts's own
   isPlausibleRevision comment). Proves the title-block GRID region and
   the revision-history grid region are found as two separate
   candidates, never merged or confused.

2. native_bottom_strip.pdf -- a DIFFERENT layout: a full-width bottom
   strip title block (not a corner box), proving the grid detector isn't
   hardcoded to one position ("support different title-block layouts").

3. scanned_no_native_text.pdf -- text baked into a page IMAGE with no
   real PDF text objects at all, forcing the pipeline down the "native
   text extraction insufficient -> targeted OCR, scoped to the detected
   region" path end to end.

4. rotated_90.pdf -- the PDF's own /Rotate page attribute set to 90, to
   prove page-rotation is read from the PDF's own declared metadata
   (exact), not a guessed OSD value (Phase 2 already found OSD's own
   confidence unreliable on this kind of sparse, vector-drawing-style
   page).
"""
import io
import os

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A3
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

PAGE_W, PAGE_H = A3  # points


def draw_grid_title_block(c, x0, y0, w, h, rows, cols_per_row):
    """A bordered grid: outer rect + internal row/col lines, text per cell."""
    c.setLineWidth(1)
    c.rect(x0, y0, w, h)
    row_h = h / len(rows)
    for i in range(1, len(rows)):
        y = y0 + h - i * row_h
        c.line(x0, y, x0 + w, y)
    for i, (row_cells, ncols) in enumerate(zip(rows, cols_per_row)):
        row_top = y0 + h - i * row_h
        row_bot = row_top - row_h
        col_w = w / ncols
        for j in range(1, ncols):
            x = x0 + j * col_w
            c.line(x, row_bot, x, row_top)
        for j, text in enumerate(row_cells):
            c.setFont('Helvetica', 9)
            c.drawString(x0 + j * col_w + 4, row_bot + row_h / 2 - 3, text)


def fixture_native_bottom_right(path):
    c = canvas.Canvas(path, pagesize=A3)
    c.setFont('Helvetica', 10)
    c.drawString(50, PAGE_H - 50, 'GENERAL ARRANGEMENT - LEVEL 3')
    draw_grid_title_block(
        c, 50, PAGE_H - 160, 260, 70,
        rows=[['Rev.', 'Date', 'Reason For Issue'], ['00', '13-02-2026', 'Issued For Approval']],
        cols_per_row=[3, 3],
    )
    tb_w, tb_h = 260, 140
    x0, y0 = PAGE_W - tb_w - 40, 40
    draw_grid_title_block(
        c, x0, y0, tb_w, tb_h,
        rows=[
            ['Drawing No:', 'Rev:'],
            ['M19-M4C-C0-PW-AX-SD-05731', 'B'],
            ['Title:'],
            ['Single Leaf Steel Door Details'],
        ],
        cols_per_row=[2, 2, 1, 1],
    )
    c.showPage()
    c.save()


def fixture_native_bottom_strip(path):
    c = canvas.Canvas(path, pagesize=A3)
    c.drawString(50, PAGE_H - 50, 'ROOF PLAN - STRUCTURAL LAYOUT')
    strip_h = 60
    draw_grid_title_block(
        c, 40, 30, PAGE_W - 80, strip_h,
        rows=[['Drawing No: S-2.03', 'Title: ROOF PLAN - STRUCTURAL LAYOUT', 'Rev: C', 'Date: 12/03/2025']],
        cols_per_row=[4],
    )
    c.showPage()
    c.save()


def fixture_scanned_no_native_text(path):
    img = Image.new('L', (1600, 1100), color=255)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
    except OSError:
        font = ImageFont.load_default()
    draw.text((60, 40), 'GENERAL ARRANGEMENT - LEVEL 3 (SCANNED)', fill=0, font=font)
    x0, y0, w, h = 900, 750, 650, 300
    draw.rectangle([x0, y0, x0 + w, y0 + h], outline=0, width=2)
    draw.line([x0, y0 + h / 2, x0 + w, y0 + h / 2], fill=0, width=2)
    draw.line([x0 + w / 2, y0, x0 + w / 2, y0 + h / 2], fill=0, width=2)
    draw.text((x0 + 10, y0 + 10), 'Drawing No:', fill=0, font=font)
    draw.text((x0 + w / 2 + 10, y0 + 10), 'Rev:', fill=0, font=font)
    draw.text((x0 + 10, y0 + h / 2 + 10), 'M19-M4C-C0-PW-AX-SD-05732', fill=0, font=font)
    draw.text((x0 + w / 2 + 10, y0 + h / 2 + 10), 'A', fill=0, font=font)

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)

    c = canvas.Canvas(path, pagesize=A3)
    c.drawImage(ImageReader(buf), 0, 0, width=PAGE_W, height=PAGE_H)
    c.showPage()
    c.save()


def fixture_rotated_90(path):
    c = canvas.Canvas(path, pagesize=A3)
    c.setFont('Helvetica', 10)
    c.drawString(50, PAGE_H - 50, 'GENERAL ARRANGEMENT - LEVEL 3 (ROTATED)')
    tb_w, tb_h = 260, 140
    x0, y0 = PAGE_W - tb_w - 40, 40
    draw_grid_title_block(
        c, x0, y0, tb_w, tb_h,
        rows=[['Drawing No:', 'Rev:'], ['M19-M4C-C0-PW-AX-SD-05733', 'C'], ['Title:'], ['Window Schedule']],
        cols_per_row=[2, 2, 1, 1],
    )
    c.showPage()
    c.save()


def set_pdf_page_rotation(path, degrees):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(path)
    pdf[0].set_rotation(degrees)
    pdf.save(path)


if __name__ == '__main__':
    out = os.path.dirname(__file__)
    fixture_native_bottom_right(f'{out}/native_bottom_right.pdf')
    fixture_native_bottom_strip(f'{out}/native_bottom_strip.pdf')
    fixture_scanned_no_native_text(f'{out}/scanned_no_native_text.pdf')
    fixture_rotated_90(f'{out}/rotated_90.pdf')
    set_pdf_page_rotation(f'{out}/rotated_90.pdf', 90)
    print('fixtures written to', out)
