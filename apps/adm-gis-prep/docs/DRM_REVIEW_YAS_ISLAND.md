# DRM review: Yas Island-YS1-P10 (Nov 2026)

> **PROVISIONAL: NOT ADM-VALIDATED.** These are lessons from one official DRM review cycle. They are not an approval.

## Inputs

The files are client drawings, so they are kept in `reference/DRM_reviews/yas_island_2026-11/`, which is not committed.

| Set | Contents |
|---|---|
| Old submission | 5 DWG floor files: building 1 (G, F1, F2), building 2 (G), building 3 (G) |
| DRM error report | `Report.xls` with 19 items, plus one PDF per item showing the error location and the flagged values |
| Rectified submission | The same 5 DWG files after correction |

The DWG files have not been read yet: there is no DWG reader here. The findings below come from the error report and its PDFs.

## What the review checks that the official CPDQC tool did not

| # | Review item | Count | Lesson | Tool change |
|---|---|---|---|---|
| 1 | DOOR/WINDOW polygon is not in the correct location; it should be adjacent to two spaces, or one space and the floor outline | 10 errors | A door or window drawn inside the wall is rejected. In the PDFs, door 7AB runs along the wall instead of across it, and window BEC stops short of the outer face. | **New DRM-LOG-22 (ERROR).** It replaces the weaker "touches a space" check. Adjacent means within 2 cm, or overlapping. All four accepted KHALIFA CITY drawings pass. **Converter:** windows now extend to the floor outline. Before this, 32 of the 34 windows on the M19B first floor would have failed. |
| 2 | Incorrect BUILDINGNUMOFFLOORS | 5 errors | `2` was rejected in every file. Building 1 had 3 floor files; buildings 2 and 3 had 1 each. The review checks this value across the whole submission. | **Not implemented yet** (DISCREPANCIES B-22). The accepted KHALIFA CITY set has `2` with 4 floor files, so "number of floor files" is not proven. The corrected values are in the rectified DWGs. |
| 3 | Incorrect BUILDINGHEIGHT | 3 warnings | `22` for building 1 was flagged as a warning. | **Not implemented yet** (B-23). The rectified value is needed to learn the rule. |

## Next step

Read the old and rectified DWGs, either as DXF exports or with a DWG reader. Then diff them per handle to confirm items 2 and 3, and check that the moved doors and windows now satisfy DRM-LOG-22.
