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
