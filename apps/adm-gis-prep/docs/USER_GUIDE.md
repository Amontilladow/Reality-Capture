# User guide for M4 engineers

> Everything this tool produces is **PROVISIONAL: NOT ADM-VALIDATED**. It prepares the drawing and runs preliminary checks. Only ADM decides acceptance, after its official QC tool and review. Never describe the output as "ADM compliant", "approved" or "passed ADM QC".

## Before you start

1. Export the drawing from AutoCAD as **DXF** (SAVEAS → *AutoCAD 2010/LT2010 DXF*). The tool cannot read DWG files directly yet.
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
