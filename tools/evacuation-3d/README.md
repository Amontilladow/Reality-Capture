# evacuation-3d

Turns AutoCAD-plotted 2D evacuation-plan PDFs into 3D axonometric "Escape & Rescue
Plan" sheets (ADCD sample layout, A1 landscape) with a QC review package.

Geometry is measured from the PDF's preserved CAD layers, never traced or
AI-generated: walls (A-HATCH poche, A-WALL, S-COLS), glazing (A-WINDOW,
A-GLAZ-CURT), escape stairs (green highlight), routes (A-ESCAPE-ROUTE), and the
embedded safety icons. The architecture is rendered with three.js (orthographic,
tiled to 8000 px); every evacuation graphic is a flat vector overlay projected
through the same camera.

## Pipeline

| Step | Script |
|---|---|
| Layered vector extraction | `extract.py` |
| Icon classification | `symbols_detect.py` |
| Walls, glazing, slab, stairs, directed route graph, YAH | `model.py` |
| Metric scene + camera | `scene.py` |
| 3D render (+ `.glb` export) | `render/render.js`, `render/page.html` |
| Sheet composition (EN/AR) | `sheet.py`, `graphics.py` |
| One sheet end to end | `build_sheet.py` |
| All-sheet analysis / register data | `analyze_all.py` |
| QC comparison sheet | `compare.py` |
| Combined review package | `make_package.py`, `report.py` |

## Usage

```sh
(cd render && npm install)
pip install pymupdf opencv-python-headless scikit-image shapely reportlab arabic-reshaper python-bidi
python3 analyze_all.py <src_pdfs> <out>
python3 build_sheet.py <src_pdfs>/<sheet>.pdf <out> GF-01 GROUND 18 52 8000
python3 make_package.py <src_pdfs> <out> GF-01
```

Chromium + Playwright must be available (`require('playwright')`).

## Known limits

- Drawing scale is not stated on the sheets; it is derived (parking bay, car and
  WC sizes) and only used for metre values in reports.
- Arrow/dot templates are tuned to the Ground Floor plot size; Basement sheets
  B-01/B-02 and GF-02 need size-relative templates. Some YAH markers and basement
  stair highlights sit on other layers. See the QC report section 7.5.
- Authority emblems and logos are placeholders: approved artwork must be supplied.
