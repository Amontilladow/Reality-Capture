# Calibration against official DRM material (2026-10-26)

## Material received from M4

The material is stored locally in `reference/DRM_samples/` and is git-ignored, so client drawings and DRM documents never go to GitHub.

| Item | File | SHA-256 (first 16 hex) |
|---|---|---|
| Specification | BDMS 4.1 Standards for DRM_270121.pdf (31 p.) | 63502036084d79a0 |
| Official QC tool | DRM_CPDQC_V2.3.fas (AutoCAD compiled LISP) | e250d5c28934734e |
| QC tool user manual | DRM_CPDQC_V2.3_UserManual.pdf (39 p.) | 1717cad958ee9520 |
| Templates | MADINAT ZAYED-MZW16-63A-1-G.dwg / -F1.dwg (AC1032) | DWG only, see below |
| Code lists | UPC_Land Use Classification.xls, ADM_Buildings Usage Type.jpg | df060231aa261add (xls) |
| Accepted drawings | KHALIFA CITY-SE45_01-C8-1-{G,F1,F2,F3}.dwg + .dxf | passed official QC |
| Original drawings | M19B-M4C-{GF,L1,L2,RF,UR}-AX-SD-0014x … FINISHING LAYOUT.dwg + .dxf | M4 architectural CAD |

**Key finding:** this material is for the **DRM BDMS 4.1 building-floor submission**, not the ADM SDD Plot/Roads/Services planning submission the tool was first built for. A second rule profile, `bdms_building` (`rules/drm_bdms_v4.1.yaml`), was added. The SDD profile is unchanged.

## What the drawings show

| | Original M4 drawing (L1) | Accepted GIS drawing (F1) |
|---|---|---|
| Coordinates | local, millimetres, x −90,852…5,930 | UTM 40N metres, E 257,617…257,898 |
| Building footprint | 64,015 × 25,315 mm, axis-aligned | 63.60 × 25.00 m, **rotated 52.19°** |
| Content | 3,910 entities on 57 architectural layers (2,547 LINEs, 358 MTEXT, 235 HATCH, 82 DIMENSION, splines, arcs) | 131 entities: 1 Plot, BuildingOutline, BuildingRoof, Floor and Unit each, 12 Spaces, 13 Doors, 34 Windows, each with its Detail block, plus Title |
| Rooms | walls as lines, room names as text | closed Space polygons + SpaceDetail |

Getting from the original to the accepted file therefore takes:
1. Scaling mm → m, rotating and moving into UTM (**control-point georeferencing**, now implemented: explicit, confirmed, with residuals reported).
2. Re-drawing rooms, doors and windows as closed polygons with Detail blocks. This part is **not automated**; see the next milestone.

## Calibration result: accepted drawings

Run in strict mode with the `bdms_building` profile, after calibration:

| Accepted drawing | ERROR | WARNING | Warning content (all genuine spec-rule-1 deviations the official QC lets through) |
|---|---|---|---|
| …-G | **0** | 11 | 9 edge crossings / near-miss snaps, 1 repeated vertex, 1 trailing space in "OFFICE AREA " |
| …-F1 | **0** | 39 | 35 crossings / near-miss snaps (0.9–4 mm), 1 space overhanging the unit, 2 repeated vertices, 1 trailing space |
| …-F2 | **0** | 39 | same as F1 (identical geometry) |
| …-F3 | **0** | 1 | 1 trailing space |

Zero errors on all four drawings means parity with the official QC that accepted them. The prepared output of each accepted drawing has the same handles and an unchanged layer table (no "fixes" to something already accepted). These expectations are enforced by `tests/test_reference_drm.py`, which self-skips when the samples are absent.

Calibration changes driven by the samples (details in DISCREPANCIES_BDMS.md):
- Snapping errors = T-junctions only (B-07).
- Space→unit by majority area (B-08).
- Door/window contact as WARNING (B-09).
- Metres instead of centimetres (B-01).
- Accepted lineweight 0.25 (B-02).
- No empty or foreign layers in the output (B-03/04).
- No paper-space content in submission files.
- Unreferenced anonymous blocks removed.

## Calibration result: original drawing

The L1 original, run with the `bdms_building` profile, gives **Blocked by errors**:
- 57 unmapped architectural layers.
- 5 missing required polygons (Plot, BuildingOutline, BuildingRoof, Floor, Space).
- 2 missing title blocks (ProjectDetail, DrawingDetail).
- Coordinate system and units not confirmed.
- 1 grouped reader-repair note.

The prepared floor file is empty, and all 3,910 entities are preserved in the `_UNMAPPED-REFERENCE` file. This is the correct outcome: the original cannot be submitted until the BDMS polygons are drawn.

## Not yet usable

- **Templates**: they are DWG (AC1032) and cannot be read without a converter. The block definitions were taken from the accepted DXFs instead. Please save the two templates as DXF so the template adapter can compare against them directly.
- **Official QC tool**: it runs only inside AutoCAD (`APPLOAD` → `QC`, report in `c:\temp\*.err`). Running it on the tool's outputs and sending the `.err` files would confirm parity end to end; they can be attached to each job.
