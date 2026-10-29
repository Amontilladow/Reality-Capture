# ADM QC trial 01: rejected conversion draft

> Output of this tool stays **PROVISIONAL: NOT ADM-VALIDATED**. This trial measures how closely our preliminary checks reproduce the official QC. It is not an approval.

**Files** (`fixtures/adm_qc_trial/`):
- `CONVERSION_DRAFT.dxf`: a draft from the platform's *convert* mode, with no metadata entered.
- `CONVERSION_DRAFT.err`: official QC tool v2.3 report, status **Rejected**, 104 errors.

| File | SHA-256 |
|---|---|
| `CONVERSION_DRAFT.dxf` | `1ee94385e4a444eeaeb8424f9ea1a52f2e05a4d1a6c8bb358bc85e9219ed2844` |
| `CONVERSION_DRAFT.err` | `414ee7d58dcdefcf1357b177265404f1bc717610408e68a0661dcc9d80978828` |

## What the draft contains (measured)

- **Polygons and blocks:** Space 12 + SpaceDetail 12, Door 17 + DoorDetail 17, Window 34 + WindowDetail 34, Floor 1 + FloorDetail 1, BuildingOutline 1 + BuildingDetail 1, Title frame + ProjectDetail + DrawingDetail. There is no Plot, BuildingRoof or Unit.
- **Block placement:** every Detail block is inside its polygon. FloorDetail and BuildingDetail are 12.6 m inside the outline.
- **SpaceNumber:** two SpaceDetail blocks are empty. The others use 1-6 and 8-11.
- **UnitNumber / FloorNumber:** empty on every Space, Door and Window block.
- **FloorDetail and BuildingDetail:** every field empty. Title blocks: every field empty.
- **Window links:** all 34 windows reference SpaceNumber 11 (OFFICE AREA), the space each of them touches.
- **Door links:** each of the 17 doors references one of the two spaces it touches.

## Step 1: our validator before this change

`m4adm` preparation, profile `bdms_building`, run on the fixture.

| Type | ADM row (layer) | ADM count | Our engine before | Count |
|---|---|---|---|---|
| A | Incorrect Drawing File Name | 1 | DRM-GEN-01 (+ DRM-GEN-02 "Incorrect Floor ID"). Built from empty metadata, not the drawing's file name | 4 + 1 |
| B | No Plot or PlotDetail found | 1 | DRM-LOG-03 (Plot) | 1 |
| C | Mismatch Error Missing Attribute Blocks in Polygons (BuildingDetail) | 1 | MISSED | 0 |
| C | Mismatch Error Missing Attribute Blocks in Polygons (FloorDetail) | 1 | MISSED | 0 |
| C | Polygon with missing Attribute Block found (BuildingOutline) | 1 | MISSED (a block is present, its key field is blank) | 0 |
| C | Polygon with missing Attribute Block found (Floor) | 1 | MISSED | 0 |
| C | Polygon with missing Attribute Block found (Space) | 2 | MISSED | 0 |
| D | Missing Value in the Attribute Block Mandatory Filed in BuildingDetail attribute block | 1 | DRM-ATT-03, one per empty field | 6 |
| D | Missing Value in the Attribute Block Mandatory Filed in FloorDetail attribute block | 1 | DRM-ATT-03, one per empty field | 3 |
| E | Incorrect SpaceNumber data entry found in SpaceDetail attribute block | 9 | MISSED (DRM-ATT-03 empty-field findings only) | 0 |
| E | Incorrect SpaceNumber data entry found in WindowDetail attribute block | 34 | MISSED | 0 |
| E | Incorrect SpaceNumber found in WindowDetail attribute block | 34 | MISSED. DRM-ATT-15 looks up the number only, and 11 exists | 0 |
| E | Incorrect SpaceNumber found in DoorDetail attribute block | 15 | MISSED, same reason | 0 |
| F | Incorrect UsageType data entry found in BuildingDetail attribute block | 1 | MISSED (empty values skipped by DRM-ATT-45) | 0 |
| F | Incorrect UsageCategoryType data entry found in BuildingDetail attribute block | 1 | MISSED | 0 |

Reported by us but **not** by the official QC in this trial:
- DRM-LOG-03 BuildingRoof missing (1);
- DRM-ATT-03 empty fields in SpaceDetail (17), DoorDetail (17), WindowDetail (34) and the title blocks (5);
- the CRS and units items (ours, no official counterpart).

Our total was 91 errors, against ADM's 104. Seven of ADM's fifteen rows were missed outright, and four more were caught under different rules or counts.

## Step 5: after the change

Same fixture, same profile, re-run after Steps 2-4. The fixture's SHA-256 is unchanged (checked by the test). The "after" counts come from the report's *Summary in official QC terms*, which now counts the way ADM does: per file, per polygon or per block, not per empty field. Every expected count in `tests/test_adm_trial_01.py` is parsed from the `.err` file.

| Type | ADM row (layer) | ADM | Before | After | Rule |
|---|---|---|---|---|---|
| A | Incorrect Drawing File Name | 1 | 4 + 1 | **1** | DRM-GEN-01 (one per file; no GEN-02 cascade) |
| B | No Plot or PlotDetail found | 1 | 1 | **1** | DRM-LOG-03 |
| C | Mismatch Error Missing Attribute Blocks in Polygons (BuildingDetail) | 1 | 0 | **1** | DRM-LOG-01 (new) |
| C | Mismatch Error Missing Attribute Blocks in Polygons (FloorDetail) | 1 | 0 | **1** | DRM-LOG-01 (new) |
| C | Polygon with missing Attribute Block found (BuildingOutline) | 1 | 0 | **1** | DRM-ATT-48 (new) |
| C | Polygon with missing Attribute Block found (Floor) | 1 | 0 | **1** | DRM-ATT-48 (new) |
| C | Polygon with missing Attribute Block found (Space) | 2 | 0 | **2** | DRM-ATT-48 (new) |
| D | Missing Value ... in BuildingDetail attribute block | 1 | 6 | **1** | DRM-ATT-03, counted per block |
| D | Missing Value ... in FloorDetail attribute block | 1 | 3 | **1** | DRM-ATT-03, counted per block |
| E | Incorrect SpaceNumber data entry found in SpaceDetail attribute block | 9 | 0 | **10** | DRM-ATT-49 (new) + SPEC-IDS. Off by one, see B-17 |
| E | Incorrect SpaceNumber data entry found in WindowDetail attribute block | 34 | 0 | **34** | DRM-ATT-49 (new) |
| E | Incorrect SpaceNumber found in WindowDetail attribute block | 34 | 0 | **34** | DRM-ATT-15 (link needs SpaceNumber + UnitNumber + FloorNumber) |
| E | Incorrect SpaceNumber found in DoorDetail attribute block | 15 | 0 | **17** | DRM-ATT-15. Off by two, see B-18 |
| F | Incorrect UsageType data entry found in BuildingDetail attribute block | 1 | 0 | **1** | DRM-ATT-45 (blank is not a valid code) |
| F | Incorrect UsageCategoryType data entry found in BuildingDetail attribute block | 1 | 0 | **1** | DRM-ATT-45 |
| | **Total (official rows)** | **104** | **91** | **107** | |

All 15 official rows are now reproduced, 13 of them with the exact count. Our summary has one extra row ADM did not report: missing values in the Title blocks (2), labelled "(not reported by the official QC in trial 01)". The per-field detail (every empty field, CRS, units, missing BuildingRoof as a WARNING) is still in the findings list; only the official-terms summary changed.

### Corrected conversion

The converter now numbers spaces progressively (1..n), writes UnitNumber/FloorNumber from settings (MISSING and status **BLOCKED** if absent), fills BuildingDetail/FloorDetail facts from settings, links each door/window to an exported space number, names the output after the BDMS file-name pattern, and places blocks at the polygon's pole of inaccessibility.

| Conversion of M19B first floor | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| No identifiers or facts entered (as in the trial) | 1 | 1 | 4 | 3 (+2 Title) | 98 | 2 |
| Identifiers + building/floor/unit facts entered | 0 | 1 | **0** | **0** | **0** | **0** |

With nothing entered, the draft is marked *BLOCKED: mandatory identifiers missing* instead of being offered as ready. The one remaining row, B (no Plot), is expected: a floor plan has no plot boundary and the converter does not invent one. The synthetic plan in `tests/test_adm_trial_01.py` gives the same result.

**Not resubmitted.** These figures are from our validator. They are not an ADM result, and the output stays **PROVISIONAL: NOT ADM-VALIDATED** until a corrected draft passes the official QC.

### Hypothesis verdict (blank keys break door/window links)

**Partly confirmed.**
- **Windows match exactly (34/34).** A link counts as broken when the block's UnitNumber or FloorNumber is blank, even though SpaceNumber 11 exists.
- **Doors are off by two (17 vs 15).** We cannot yet tell which two doors ADM accepts.
- **SpaceDetail data entry is off by one (10 vs 9).**
- **The key note 8 "progressive numbering" rule is not enforced as an error.** Accepted drawing G has gaps, so DRM-ATT-51 is INFO only (B-16).

All of these are logged in `DISCREPANCIES_BDMS.md` (B-16 to B-20) rather than guessed.
