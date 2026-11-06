# ADM QC trial 02: first floor converted with identifiers

> **PROVISIONAL: NOT ADM-VALIDATED.** These figures come from the official QC tool (v2.3) run by the user.
> They are not an approval.

**Inputs**
- **Source drawing:** M19B first floor, converted on the platform after PR #97 (settings now reach the engine).
- **Official QC result:** `khalifa city-se45_01-c8-1-f1`, **Rejected, 104 errors** (18 rows). The report was supplied by the user and is not committed.
- **Reference:** the DRM-accepted `KHALIFA CITY-SE45_01-C8-1-{G,F1,F2,F3}` drawings.

## Main finding: the official QC reads block attributes by position

All accepted drawings store Detail-block attributes in **reverse spec-table order**. ProjectDetail is the one exception.

For example, in FloorDetail:

| Source | Attribute order |
|---|---|
| Accepted drawings | `FLOORHEIGHT, BUILDINGNUMBER, FLOORNUMBER` |
| Our draft (spec order) | `FLOORNUMBER, BUILDINGNUMBER, FLOORHEIGHT` |

Because our draft used spec order, the official QC read the wrong fields:
- it read our FloorNumber as the FloorHeight;
- it read our SectorNumber as the BuildingNumber;
- it read our SpaceUsage as the SpaceNumber.

This also explains the unexplained B-17 count from trial 01. The 9 SpaceNumber errors are the 12 spaces minus the 3 with an empty SpaceUsage.

## Rows, causes and status

| # | Official row | Count | Cause | Status |
|---|---|---|---|---|
| 1 | BuildingOutline exits without corresponding Plot Polygon | 1 | No Plot | Open: the plot boundary must come from the site or affection plan |
| 2 | No Plot or PlotDetail found | 1 | Same | Open |
| 3 | Floor exits without corresponding BuildingRoof Polygon | 1 | No BuildingRoof was written | **Fixed**: the BuildingRoof is drawn on the outline, as in the accepted drawings, with BuildingHeight from settings |
| 4 | Incorrect Floor ID in the File Name | 1 | `f1` was typed in lowercase | Input: must be `F1` |
| 5 | Inconsistent Building Number, File Name vs BuildingDetail | 1 | Attribute order | **Fixed** (template order) |
| 6 | Space exits without corresponding Unit Polygon | 1 | No unit number in the job | Input: enter the unit number |
| 7 | Inconsistent Building Number, FloorDetail vs BuildingDetail | 1 | Attribute order | **Fixed** |
| 8–9 | Missing Value in ProjectDetail / DrawingDetail | 1 + 1 | ProjectDetail PropertyName is empty; DrawingDetail was read in the wrong order | Order **fixed**. Whether PropertyName is mandatory is still to confirm |
| 10 | Invalid Date format in DrawingDetail | 1 | `29 oct 26` was typed | Input: must be `29-OCT-2026` |
| 11 | Incorrect FloorHeight data entry | 1 | Attribute order | **Fixed** |
| 12 | Incorrect SpaceNumber data entry (SpaceDetail) | 9 | Attribute order | **Fixed** |
| 13 | Incorrect SpaceNumber data entry (WindowDetail) | 34 | Attribute order: Type `glass` was read as the SpaceNumber | **Fixed** |
| 14–15 | Incorrect SpaceNumber in WindowDetail / DoorDetail | 34 / 13 | Attribute order, plus an empty UnitNumber | **Fixed** once the unit number is entered |
| 16–17 | Incorrect UsageType / UsageCategoryType data entry | 1 + 1 | `single use` and `commercial` were typed | Input: use the exact code-list values |
| 18 | Snapping errors between BuildingOutline, Floor, Space, Unit, Window and Door | 1 | The draft has 2 slightly overlapping space pairs and 3 opening corners 1–5 cm off a room edge | Open: next to investigate |

## Changes made

- **Manifest:** `template_order` per Detail block, taken from the accepted drawings.
- **Converter and synthetic fixtures:** write blocks in that order.
- **New rule DRM-ATT-52:** flags blocks stored in any other order.
- **BuildingRoof:**
  - the converter writes it;
  - a missing BuildingRoof is an ERROR again, under the official wording (B-19 resolved).
- **Web form:** new "Building height" field.

With correct inputs, our validator now reports only "No Plot" for this floor. The next official QC run is the evidence that counts.
