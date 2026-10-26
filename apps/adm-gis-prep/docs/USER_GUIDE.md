# User guide for M4 engineers

> Everything this tool produces is **PROVISIONAL: NOT ADM-VALIDATED**. It prepares the drawing and runs preliminary checks. Only ADM decides acceptance, after its official QC tool and review. Never describe the output as "ADM compliant", "approved" or "passed ADM QC".

## Which standard?

| Drawing | Profile | Files |
|---|---|---|
| Master plan / plots, roads, service corridors for ADM SDD | **ADM SDD planning v1.18.2** (`sdd_planning`) | one per dataset: `<ProjectID>_<YYYYMMDD>_<AP/MP>_<Plot/Roads/Services>_ADM` |
| Building floors for the DRM construction permit / completion certificate (BDMS) | **DRM BDMS 4.1 building floor** (`bdms_building`) | one per floor: `<Zone>-<Sector>-<Plot>-<Building>-<Floor>`, e.g. `KHALIFA CITY-SE45_01-C8-1-F1` |

**Strict mode** is on by default: the job reaches *Ready for review* only when there are **no errors and no warnings** and no open decisions. Untick it only for exploratory runs.

## BDMS building floors: what the drawing must contain

One floor of one building per file, in UTM metres (zone 40N, or 39N in western Al Dhafra), with these closed LWPOLYLINE layers and one Detail block inside each polygon:

- `Plot` + `PlotDetail`
- `BuildingOutline` + `BuildingDetail`
- `BuildingRoof` + `BuildingRoofDetail`
- `Floor` + `FloorDetail`
- `Unit` + `UnitDetail`
- `Space` + `SpaceDetail` (spaces may be nested one level)
- `Door` + `DoorDetail`, `Window` + `WindowDetail`
- `ProjectDetail` and `DrawingDetail` blocks on `Title`

Where polygons of these layers meet, every vertex lying on another polygon's edge needs a matching vertex there. The official QC reports this as a "Snapping error". Copy the Detail blocks from the DRM template; never edit their tags.

**Original architectural drawings** (walls as lines, mm, local coordinates) cannot be submitted as they are:
1. Draw the BDMS polygons on the BDMS layers (or map existing closed polylines to them in the review page).
2. Georeference: enter at least 2, better 3–4, control points (local x,y → UTM E,N, e.g. plot corners from the affection plan) and confirm. The tool fits scale + rotation + shift, shows the residuals, and refuses a fit worse than 0.05 m.
3. Run, fix what the report lists, and re-run until *Ready for review*.

CLI example:

```bash
m4adm prepare "KHALIFA CITY-SE45_01-C8-1-F1.dxf" --profile bdms_building \
  --zone "KHALIFA CITY" --sector SE45_01 --plot C8 --building 1 --floor F1 --contractor "M4 Contracting" \
  --source-crs EPSG:32640 --crs-confirmed --units-confirmed
# local mm drawing: --control-points points.txt --confirm-transformation --crs-confirmed
```

The report has a **"Summary in official QC terms"** table that uses the QC tool's own error names (e.g. "Snapping errors found between layers …"), so it can be compared line by line with the official `.err` report.

## Before you start

1. Use the drawing as **DXF** (AutoCAD: SAVEAS → *AutoCAD 2010/LT2010 DXF*), or upload the **DWG** directly if ODA File Converter or LibreDWG is installed on this PC (see SETUP). The original DWG stays the master; the report records which converter was used.
2. Know the drawing's **coordinate system**. ADM requires WGS 84 / UTM zone 40N (EPSG:32640). If you are not sure, check it against the SDD reference data. Do not guess.
3. Check that the drawing is at **full scale in metres** by measuring a known plot frontage.
4. Have the **CDP Project ID** and the submission date ready.

## Ten-step workflow

1. Start the app (`m4adm ui`) and open http://127.0.0.1:8765.
2. **Upload** the DXF, or pick a previous upload. The original is stored read-only and is never changed.
3. Tick the **categories**: Plot, Roads, Services. Each category becomes its own file. For a Master Plan (MP), tick all three.
4. Enter the **Project ID, date (YYYYMMDD), AP/MP, ADM/DOT**, and the consultant and/or contractor name.
5. Select the **source coordinate system** and tick the confirmation. Tick **units confirmed (metres)**. Selecting a CRS only *declares* it; the tool never moves geometry because it "looks wrong".
6. Click **Prepare for ADM GIS**.
7. Read the job page:
   - **Status**: *Blocked by errors* / *Prepared with warnings* / *Ready for review*.
   - **Official QC**: stays *not yet performed* until you attach the real report from the official tool.
   - **Blocking items** are listed first, each with the next action.
8. **Review**:
   - *Layer mapping*: each layer the tool does not recognise is listed. Choose the ADM layer it represents, or *Exclude*. The tool never decides this for you. The name hints are suggestions only.
   - *Proposed fixes*: tick only the ones you accept. Lossless fixes (closing an already-closed polyline, converting a 2D polyline to LWPOLYLINE, resetting colours to BYLAYER) do not move geometry. *Densify arcs* moves the curve by at most the stated tolerance.
   - Click **Re-run with these decisions**. This creates a new job from the unchanged original; the previous job is kept.
   - Fix everything else in **AutoCAD**, using the handle (`#1A3`) and coordinates in each finding, then export the DXF again and repeat.
9. **Export**: check the pre-export summary (files, entity counts, changes), enter your name, tick the acknowledgement and click **Export package**.
10. Convert each dataset DXF to **DWG (AutoCAD 2010 or 2012 format)** in AutoCAD and rename `.dxf` to `.dwg`, keeping the same name. Then run the **official ADM QC tool** and attach its report on the job page.

## What the files are

| File | Purpose |
|---|---|
| `output/<ProjectID>_<date>_<AP/MP>_<Plot/Roads/Services>_ADM.dxf` | Prepared dataset file, R2010 DXF |
| `output/…_additional_ADM.dxf` | Everything not mapped to an ADM layer, on its original layers (reference only, spec §4.1) |
| `qc_report.html` / `.json` | Preliminary QC report |
| `geometry_log.json` | Every entity modified, kept out of the ADM files, or unresolved |
| `processing_manifest.json` | Source and output SHA-256, settings, rule version, errors and warnings |
| `audit.jsonl` | Time-stamped record of every step and decision |

## Reading a finding

`ERROR ADM-CAP-006 · PlotDetail #1E1 · p.16, §5, rule 6 · "Attribute block insertion point is not inside any Plot polygon" · Next: Move the block inside its Plot polygon`

- **Severity**: ERROR means a definite rule violation. WARNING means a possible issue to review. INFO is information only.
- **Evidence**:
  - VERIFIED_SPEC means the rule is in the ADM PDF.
  - ENGINEERING_CHECK means it is an M4 check, not an ADM rule.
  - PENDING_OFFICIAL_CONFIRMATION means the template, QC tool or ADM must confirm it.
  - USER_DECISION_REQUIRED means you must decide.

## CLI equivalent

```bash
m4adm prepare drawing.dxf -c plot -c roads --project-id P101 --date 20261025 --drawing-type AP \
  --contractor "M4 Contracting" --source-crs EPSG:32640 --crs-confirmed --units-confirmed \
  --mapping my_layers.yaml --accept-fix all:CLOSE_FLAG
m4adm check-name P101_20261025_AP_Roads_ADM.dwg
m4adm history
m4adm export workspace/jobs/<job> --by "Eng. Name" --acknowledge
m4adm attach-qc workspace/jobs/<job> --file qc_output.txt --outcome failed --by "Eng. Name"
```

`my_layers.yaml`:

```yaml
layers:            # source layer -> ADM layer (or __exclude__)
  C-PLOT-BNDY: Plot
  C-PLOT-TAG: PlotDetail
  X-TEXT: __exclude__
handles:           # single-entity overrides
  "1A3": RoadEdge
```

`prepare` exit codes: 0 = completed, 3 = completed but blocked by errors, 1 = failed (no output), 2 = usage error.
