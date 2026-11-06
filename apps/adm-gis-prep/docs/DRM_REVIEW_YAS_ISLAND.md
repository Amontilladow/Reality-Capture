# DRM review: Yas Island-YS1-P10 (Nov 2026)

> **PROVISIONAL: NOT ADM-VALIDATED.** These are lessons from one official DRM review cycle. They are not an approval.

## Inputs

The files are client drawings, kept under `reference/DRM_reviews/yas_island_2026-11/` (git-ignored, never committed).

| Set | Contents |
|---|---|
| Old submission | 5 DWG (R2018) floor files: building 1 (G, F1, F2), building 2 (G), building 3 (G) |
| DRM error report | `Report.xls`, 19 items, plus one PDF per item showing the location and the flagged values |
| Rectified submission | The same 5 files after correction |

The DWG files were read with the open-source LibreDWG reader (`@mlightcad/libredwg-web`), and every block and polygon was diffed by handle, ignoring a 60 m shift the whole drawing received.

## What changed between the old and the rectified files

| Review item | Count | What DRM's fix was | Tool change |
|---|---|---|---|
| Door/window **not adjacent** to two spaces, or one space and the floor outline | 11 errors | **Geometry only.** Openings were extended by 2 to 28 cm to reach the second space or the floor edge, or the Space polygon got extra vertices (28 to 32, 86 to 88) so the opening meets it. No attribute changed. | DRM-LOG-22 (ERROR), calibrated below. Converter: windows span the wall to the Floor polygon. |
| **BUILDINGNUMOFFLOORS** | 5 errors | Building 1 (G, F1, F2): `2` to `3`. Buildings 2 and 3 (G only): `2` to `1`. In every case it equals the **number of floor files submitted for that building**. | Form label states the rule. Not enforced in the validator, which sees one file. See DISCREPANCIES B-22. |
| **BUILDINGHEIGHT** | 3 warnings | Building 1: `22` to `19.7`. Buildings 2 and 3: `5.5` to `5`. | **No rule.** Building 1's floors add up to 4.5 + 5 + 5 = 14.5 m, not 19.7, so the value is not derivable from the drawing; the two single-floor buildings simply got their floor height (5). It must come from the roof plan. See B-23. |

Nothing else changed: no layer, no other attribute value, no block position (apart from the shared shift).

## Calibrating DRM-LOG-22 on real data

All 294 doors and windows of the old files were measured against the 11 flagged handles:

| Floor outline taken as | Tolerance | Flagged handles caught | False alarms |
|---|---|---|---|
| Floor polygon | 0.1 mm to 1 mm | 11 of 11 | 3 |
| Floor polygon | 5 mm to 1 cm | 11 of 11 | 0 |
| Floor polygon | 2 cm | 10 of 11 (door 291, gap 1.99 cm, missed) | 0 |
| BuildingOutline | any | 10 to 11 of 11 | 10 to 12 |

So the outline is the **Floor** polygon, and the tolerance has to lie between 5 mm and 1.99 cm. It is set to **1.5 cm**, which also accepts the 1.09 cm gap in the DRM-accepted KHALIFA CITY G drawing. `tests/test_yas_review.py` reproduces exactly the 11 flagged handles from the extracted geometry (skipped when `reference/` is absent).

## Reading the DWG files

The ten DWG files (R2018, `AC1032`) were first read with a WebAssembly build of LibreDWG, then converted with the native LibreDWG `dwg2dxf` (the same program the cloud service now installs for DWG uploads).

| Check | Result |
|---|---|
| Native `dwg2dxf` vs the WASM reader, per handle (attributes, block positions, polygon vertices) | 0 mismatches on all 5 rectified files (480+ entities) |
| `dwg2dxf` DXF vs AutoCAD's own DXF of the same drawing (`test_dwg_conversion_matches_autocad_dxf`, KHALIFA CITY F1) | identical layers, entity counts and attributes: passes |
| Time and memory of `dwg2dxf` on these 60 to 100 KB DWGs | well under 1 s, about 11 MB |
| Full validation of the old DWGs through the converter | flags exactly the 11 handles DRM flagged |
| Full validation of the rectified DWGs through the converter | clean, except two documented disagreements on 1-G: DISCREPANCIES B-24 (door `2AC`) and B-25 (Space `26D`) |

The memory figure is for small drawings. A large DWG (an 8 MB file that becomes a 35 MB DXF) has not been measured yet.

