# CAD-to-GIS conversion (architectural floor plan → DRM BDMS 4.1 building-floor draft)

> Output of this module is a **DRAFT for engineer review**, labelled `PROVISIONAL: NOT ADM-VALIDATED`. It is never described as approved, compliant or ready for submission. Only the official QC tool and the authority decide acceptance.

```
UPLOAD → ANALYSE → GENERATE FEATURES → REVIEW → TRANSFORM COORDINATES → EXPORT → QC
```

## 1. Gap analysis (why the first release only reported problems)

| Finding | Where | Consequence |
|---|---|---|
| The pipeline mapped source **layers** to target layers and copied entities. It never created geometry. | `pipeline.prepare`, `mapping/` | An architectural plan (walls as lines, rooms as text) has nothing to map, so every target feature was "missing". |
| Target rules (closed Space polygons, Detail blocks, snapping) ran on the **raw source**. | `validate/` | Hundreds of correct-but-irrelevant errors: the source is not supposed to satisfy the target schema. |
| No stage turned walls into rooms, text into attributes, or mm/local into metres/UTM, except control-point georeferencing of *existing* target entities. | — | No path from source to target. |

Kept unchanged: the preparation pipeline (`m4adm prepare`) for drawings that already follow the schema, all validators, the DWG adapter, the job/audit model and the platform integration. Added: `m4adm.convert` (this document), which runs the validators on the **generated** drawing only.

## 2. Pipeline stages

| Stage | Module | What it does |
|---|---|---|
| A Source inspection | `convert/source.py` | Model space only. Layer and entity statistics. Units from `$INSUNITS`, or declared (unknown blocks the job). |
| B Normalisation | `convert/source.py` | Blocks exploded virtually (layer `0` inside a block takes the reference's layer), curves flattened (5 mm), everything in metres. Each primitive keeps its top-level source handle. |
| C Detection | `convert/rooms.py` | Wall/window barriers, doorway openings, room labels. |
| D Regions | `convert/rooms.py` | Enclosed free space → room polygons, classified. |
| E Mapping | `convert/features.py` | Rooms → `Space`, doorway groups → `Door`, window blocks → `Window`, outer wall boundary → `Floor` / `BuildingOutline` / (`Unit`). |
| F Attributes | `convert/features.py` | Every Detail attribute with its provenance (see §5). |
| — Topology | `convert/topology.py` | Generated geometry only. Windows extended to the room face; door and window vertices snapped (≤ 3 cm); vertices of different features within 1.5 cm merged; shared vertices inserted. |
| G Coordinates | `convert/georef.py` | Unit conversion (stage B) is kept separate from georeferencing (control points, checks, confirmation). |
| H Target drawing | `convert/writer.py` | A new DXF R2010 holding only target layers and Detail blocks. |
| I Validation | `convert/__init__.py` | The existing preliminary QC run on the generated draft, in `validation/<job>/`. |
| J Export + audit | `convert/__init__.py`, `report.py` | `conversion_report.json/.html`, `features.json`, `preview.svg`, `audit.jsonl`. Source SHA-256 is checked before and after. |

## 3. Room detection algorithm

All tolerances are in metres (`ConversionTolerances`, configurable per job).

1. **Barriers.** Lines, closed outlines and hatches on layers matching the *wall* and *window* role patterns (defaults: `*WALL*`, `*CURT_WALL*`, `*CURT_PANEL*`, `*COLUMN*`, `*DOOR*FRAME*`, `*WINDOW*`, `*GLAZ*`; never `*ANNO*`, `*IDEN*`, `*TEXT*`, `*DIM*`, `*TAG*`, `*GRID*`, `*TBLE*`, `*TITLE*`).
   - A closed outline narrower than 0.7 m everywhere is a solid wall piece.
   - Everything is grown by `gap_close/2` (default 20 mm gaps). This closes drafting gaps and nothing larger, and the count is logged.
2. **Doorway openings.** A gap is closed with a *virtual* line only between two **aligned wall ends**, when all of these hold:
   - the two convex wall corners are `opening_min`–`opening_max` apart (0.5–2.5 m);
   - at each corner a wall face continues along the gap line (within 5°) and away from the other corner;
   - the gap line crosses only free space.

   Shortest first. Each corner closes at most one opening, and closures never cross. Gaps between a free-standing column and a wall, wider openings, and unaligned gaps are **not** closed. Closures are drawn dashed in the preview and are never written as walls.
3. **Envelope.** The barrier component (walls plus closures) with the largest filled area is the floor.
   - If its filled area is under 1.5× the wall area itself, the exterior is not closed and the job is **blocked**, with the reason.
   - If the outline covers under 60 % of the wall geometry's extent, the Floor goes to **review**: an exterior gap may have left rooms outside.
4. **Regions.** Free space inside the envelope, cut by the closures, makes the candidate regions. Each is grown back to the wall face, never into a neighbour across a doorway.
5. **Classification.**

   | Region | Status | Reason recorded |
   |---|---|---|
   | narrower than 0.45 m or smaller than 0.8 m² | `NOT_GENERATED` | wall cavity, reveal or sliver |
   | exactly one distinct room name inside | `AUTO_GENERATED_HIGH_CONFIDENCE` | name and how it was closed |
   | several names inside | `GENERATED_REQUIRES_REVIEW` | a separating wall may be missing or not on a wall layer |
   | no name inside | `GENERATED_REQUIRES_REVIEW` | shaft, duct, void or unlabelled room |
   | label within 0.5 m outside a region | `GENERATED_REQUIRES_REVIEW` | label attached to the nearest room |
   | label in no region | `UNRESOLVED` | room not closed, or outside the building |
   | island ≤ 4 m² inside a room (column) | room keeps `HIGH` | island included, logged |
   | island > 4 m² inside a room | `GENERATED_REQUIRES_REVIEW` | a closed polyline cannot exclude it |

   **Text never creates geometry.** A label only names a region that walls already enclose.
6. **Doors.** Parallel closures across one wall (≤ 0.6 m apart) form one door rectangle. It is extended across the wall to the room face on each side.
   - A door must join two rooms, or one room and the outside when a door block is at the opening.
   - Otherwise it is not written: facade glazing joints are not doors.
   - All doors are `GENERATED_REQUIRES_REVIEW`, because a door and an open passage look the same in walls.
7. **Windows.** Each block reference on a *window* layer inside the floor becomes the rectangle bounding its geometry. It is extended to the adjacent room face (≤ 0.6 m) so it touches a Space, as DRM requires.

## 4. Target schema (verified from the accepted drawings)

Inspected directly: `KHALIFA CITY-SE45_01-C8-1-{G,F1,F2,F3}.dxf` (DRM QC passed). The F1 file is the GIS version of the M19B first floor: its ProjectDetail reads `BUILDINGNAME = Masdar office Building M19-B`. Encoded in `rules/drm_bdms_v4.1.yaml`.

| Item | Accepted F1 drawing |
|---|---|
| Units / CRS | metres, WGS 84 / UTM 40N; building rotated about 52° to grid |
| Features (F1) | Floor 1, BuildingOutline 1, BuildingRoof 1, Plot 1, Unit 1, Space 12, Door 13, Window 34, Title frame 1 |
| Geometry | closed LWPOLYLINE per feature; one Detail INSERT inside each polygon, on the matching Detail layer |
| Space | inner wall faces (wall thickness between neighbouring spaces); the office area is one space around the core |
| Door / Window | thin rectangles across the wall, touching the spaces they join |
| Unit | one unit = the floor outline (single-tenant floor) |
| Title | `ProjectDetail` (DEVELOPERNAME, PROPERTYNAME, UNIQUEBUILDINGNUMBER, BUILDINGNAME) and `DrawingDetail` (DRAWINGTITLE, DRAWINGTYPE, DATEOFDRAWING, DRAWINGSCALE) INSERTs on `Title` |
| Detail tags | upper case in the drawing (e.g. SPACEDETAIL: SPACENUMBER, UNITNUMBER, FLOORNUMBER, SPACEUSAGE). Full tables in the manifest and COMPLIANCE_MATRIX_BDMS.md |

Patterns in the accepted file that are **project-specific or placeholders, and are not copied**:
- `UNITOWNERNAME = UnitOwnerName` and similar tag-name placeholders;
- `UNITUSAGETYPE = Household Living` on an office floor;
- space numbers 1–12 that do not follow the source's 01-xx room numbers.

**Authority.** The supplied specification, QC tool and accepted drawings are all the BDMS 4.1 building submission:
- `BDMS 4.1 Standards for DRM_270121.pdf`;
- `DRM_CPDQC_V2.3.fas`;
- the accepted Khalifa City files.

The ADM SDD v1.18.2 planning specification (`sdd_planning`) is a different submission with its own schema, and is not used for building floors. The conversion therefore targets `bdms_building` only. **Open item for M4:** confirm which authority receives the M19B floor submissions. The project uses both "ADM" and "DRM" names, and the tool does not treat them as interchangeable.

## 5. Mapping and attributes

Every attribute in the report and in `features.json` has a provenance:

| Provenance | Meaning | Examples |
|---|---|---|
| `SOURCE` | read directly from the drawing | SPACEUSAGE from the room-name text |
| `DERIVED` | deterministic documented rule | UNITAREA from the polygon; DRAWINGTITLE from the BDMS file name; window TYPE `glass` from a block named "Double Glass Panel" |
| `PROPOSED` | rule output an engineer must confirm | SPACENUMBER `4` from room number `01-04`; door/window SPACENUMBER from the adjacent room |
| `USER` | entered by the engineer | floor id, building number, unit number, floor height, title values, decisions |
| `MISSING` | not available, never guessed | owner data, usage type, number of floors, plot, roof |

Configuration (`ConversionSettings`, YAML/JSON via `m4adm convert --settings`):
- `roles`: layer patterns for wall / window / door / room_label;
- `never_barrier`;
- `room_number_pattern`;
- `tolerances`;
- the floor facts: `floor_height`, `building_*`, `single_unit_number`, `title_values`;
- `feature_decisions`: `{feature_id: {action: accept|reject, attributes: {TAG: value}}}`. Applied in batch on a re-run of the unchanged original; rejected features are not written.
- `template_path`: a DXF whose block definitions are copied, e.g. the DRM template saved as DXF. Refused by the cloud service, which cannot read server paths.

### Identifiers required by the official QC (ADM QC trial 01)

These rules were added after the official QC rejected the first platform draft. Evidence: [ADM_TRIAL_01.md](ADM_TRIAL_01.md), DISCREPANCIES_BDMS B-16…B-20.

- **Space numbering.** SpaceNumber is numbered 1, 2, 3 … with no gaps or blanks, after review decisions are applied. Rooms with a source room number come first, in that number's order; the source number ("01-04") is kept in the note. Then come the other rooms by decreasing area. A room with no usable name still gets a number and stays a review item. Numbers an engineer enters are kept.
- **Opening links.** Door and window SpaceNumber is a proposal, but it always points at an existing SpaceDetail number. That is the number of the room the opening serves or touches.
- **UnitNumber and FloorNumber.** These are written on every Space, Door and Window block from `single_unit_number` and the floor ID. If either is not provided it stays MISSING and the status becomes *Draft generated - BLOCKED: mandatory identifiers missing*. The draft is still written for review, and the identifiers are never guessed.
- **Building and Floor details.** BuildingDetail and FloorDetail are filled from the settings: number of floors, floor height, usage category and type (code lists), plot, sector and building number. Anything not supplied stays MISSING and is listed before export.
- **Block placement.** Detail blocks are placed at the polygon's pole of inaccessibility, so they sit well inside it (official key note 5). Floor, BuildingOutline and Unit share one outline, so their blocks are spaced apart on it.
- **File name.** The draft is named exactly `<Zone>-<Sector>-<Plot>-<Building>-<Floor>.dxf`, because the official QC checks the drawing's own file name. The draft status lives in the header, the job folder and the report.

## 6. Coordinates

1. **Units** (stage B): scale only, from `$INSUNITS` or declared. Unknown units block the job.
2. **Georeferencing** (stage G): a 2D similarity fitted to engineer control points. Source points are given in drawing units (as read in CAD), targets as UTM E/N metres. It is applied only when **every** check passes **and** `confirm_transformation` is set:
   - target CRS is EPSG:32639 or 32640;
   - at least 2 points (3+ recommended; two give no residual check);
   - fitted scale within 1 ± 0.2 % (a wrong unit or mismatched point shows here);
   - RMS ≤ `max_georef_rms` (0.05 m);
   - leave-one-out: a point the others place more than 3 × RMS-limit away is named as inconsistent;
   - points span ≥ 30 % of the floor diagonal and are not collinear;
   - the transformed floor lies inside the Abu Dhabi emirate window.

   Otherwise the draft stays in local metres. Its header says `M4_GEOREFERENCED = NO - LOCAL COORDINATES`, and the status reads *Draft generated - NOT georeferenced - not for submission*. Nothing is shifted to "look right".

## 7. Measured result on the real M19B first floor

Command:

```
m4adm convert "M19B-M4C-L1-...FIRST FLOOR....dxf" --zone "KHALIFA CITY" --sector SE45_01 --plot C8 --building 1 --floor F1 --unit-number 1
```

The run takes about 30 s and peaks at about 200 MB. It is compared with the accepted `KHALIFA CITY-SE45_01-C8-1-F1.dxf` by `convert/compare.py`, using an alignment fitted to matched room centroids for **measurement only**. These checks are in `tests/test_convert_reference.py` (skipped without the local files).

| Metric | Generated | Accepted |
|---|---|---|
| Space | 12 | 12 |
| Window | 34 | 34 |
| Door | 18 | 13 |
| Rooms matched by name | 8 of 12 | |
| Mean IoU of matched rooms | **0.938** | |
| Office area IoU | 0.985 | |
| Lift lobby / lobby / staircase / telecom / electrical IoU | 0.96–0.98 | |
| Service / passenger lift IoU | 0.81 / 0.88 | the accepted drawing simplified the lift shafts |

Not matched:
- **Male and female toilet:** each is sent to review because the ADA toilet inside it is separated only by cubicle partitions not on a wall layer.
- **Janitor rooms:** two rooms share the name in the accepted file.

The alignment fitted to the accepted drawing has scale **0.9973**: the accepted GIS drawing is 0.27 % smaller than the architectural source. It was redrawn, not transformed. Control points taken from it would be rejected by the 0.2 % scale check, which is intended; survey or affection-plan points should be used.

Preliminary QC of the generated draft, against the raw source (87 errors / 304 warnings before the topology stage):
- **Errors (24):** missing information only. Plot and roof, the unknown CRS while not georeferenced, owner/usage/floor-height values, and the 3 rooms without a name or number.
- **Warnings (14):** sub-centimetre door/window junctions for review.

## 8. Limitations (also listed in every report)

- **Output format:** DXF R2010 only. DWG needs AutoCAD or a licensed SDK; DWG *input* works through ODA File Converter / LibreDWG when installed.
- **Walls:** 2D walls on the configured layers only. Walls only inside unresolved XREFs, or rooms closed only by furniture, finishes or partitions on other layers, are not detected.
- **Doorways:** closed between aligned wall ends 0.5–2.5 m apart; others are left open and reported.
- **Missing facts:** units, plot, roof outline, building-level facts and owner data are not on an architectural floor plan. They stay MISSING until entered.
- **Proposals:** space numbering and door/window SpaceNumber links are proposals.
- **Blocks:** without the official DRM template (DWG only), Detail blocks are built from the BDMS 4.1 attribute tables and the report says so.
- **Scope:** one building floor per drawing; multi-building drawings are not split.
