# Sample end-to-end run (synthetic data)

All input here is **SYNTHETIC, NOT AN OFFICIAL ADM SAMPLE** (`fixtures/`). The output below is copied from real runs on 2026-10-25 (job ids and handles will differ when you repeat it).

## 1. Inspect

```
$ m4adm inspect fixtures/SYNTHETIC_mixed.dxf
"format": "DXF-ASCII", "version_code": "AC1024", "release": "AutoCAD 2010-2012", "release_within_autocad_2012": true
$INSUNITS=6  entities=21  types={'LWPOLYLINE': 10, 'INSERT': 9, 'LINE': 1, 'POINT': 1}
  C-ANNOT        -> -          UNRESOLVED     1  LWPOLYLINEx1
  Plot           -> Plot       VERIFIED_NAME  2  LWPOLYLINEx2
  RoadEdge       -> RoadEdge   VERIFIED_NAME  3  LINEx1, LWPOLYLINEx2
  SURVEY-POINTS  -> -          UNRESOLVED     1  POINTx1
  ...
```

## 2. Prepare a Master Plan (all three datasets)

```
$ m4adm prepare fixtures/SYNTHETIC_mixed.dxf -c plot -c roads -c services --project-id P101 --date 20261025 \
    --drawing-type MP --consultant "Synthetic Consultant" --contractor "M4 Contracting" \
    --source-crs EPSG:32640 --crs-confirmed --units-confirmed
PROVISIONAL: NOT ADM-VALIDATED
M4 ADM GIS preparation v0.1.0 - specification v1.18.2
Job 20261025T133655Z-3f5f8de1: Blocked by errors | Official QC not yet performed
  errors=9 warnings=4 info=2 blocking=0 unresolved_layers=2 open_fixes=0
  source unchanged (SHA-256 verified): True
  output: P101_20261025_MP_Plot_ADM.dxf (6 entities, verified=True)
  output: P101_20261025_MP_Roads_ADM.dxf (9 entities, verified=True)
  output: P101_20261025_MP_Services_ADM.dxf (8 entities, verified=True)
  output: P101_20261025_MP_additional_ADM.dxf (2 entities, verified=True)
exit=3
```

Findings (from `qc_report.json`):

| Sev | Rule | Layer #handle | Problem | Next action |
|---|---|---|---|---|
| ERROR | ADM-ATT-001 | RoadEdge #192 | RoadEdge feature has no RoadEdgeDetail attribute block. | Insert one RoadEdgeDetail block snapped to one of its vertices |
| ERROR | ADM-ATT-004 | PlotDetail #187 | UsageCategoryType = 'Residential' is not allowed (did you mean 'residential'? values are case-sensitive). | Use a listed value |
| ERROR | ADM-ATT-004 | RoadEdgeDetail #193 | Medium = 'Surface' … did you mean 'surface' | Use one of surface, air, underground, semiBuried, undefined |
| ERROR | ADM-ATT-006 | ServiceWorkAreaDetail #1AC | ExpectedStartDate = '2024-01-05' is not DD-MON-YYYY | Write like 05-DEC-2013 |
| ERROR | ADM-ATT-007 | RoadCenterLineDetail #198 | RoadNameArabic required because RoadNameEnglish is filled in | Enter RoadNameArabic |
| ERROR | ADM-CAP-006B | RoadEdgeDetail #193 | Attribute block lies on the line but not on a vertex | Snap to a vertex (Figure 4) |
| ERROR | ADM-CAP-007 | RoadEdge #1A0 | LINE entity is not allowed | Redraw as LWPOLYLINE |
| ERROR | ADM-SRV-002 | ServiceCorridor #1A1 | Corridor overlaps plot 17F (25 m²) and plot 186 (150 m²) | Only touch plot boundaries |
| WARNING | ADM-LYR-002 | RailRoadCenterline | linetype Continuous (expected Track) | Load `Track` from the official template (not fabricated) |
| WARNING | ENG-SHARED-001 | Title | 2 entities copied into each of the 3 dataset files | Confirm, or assign per file |
| WARNING | USR-MAP-001 | C-ANNOT, SURVEY-POINTS | Not an ADM layer; kept in the additional file until mapped | Assign an ADM layer or exclude |
| INFO | ADM-FMT-001 / ADM-NAME-009 | - | Output is DXF R2010; DWG converter UNAVAILABLE | Convert to DWG 2010/2012 and rename to .dwg |

Job folder: `input/` (read-only copy) · `work/prepared_full.dxf` · `output/*.dxf` · `qc_report.json` · `qc_report.html` · `processing_manifest.json` · `geometry_log.json` · `review_queue.json` · `audit.jsonl` · `README.txt`.

## 3. Proposed fixes, then accepted fixes

```
$ m4adm prepare fixtures/SYNTHETIC_fixable.dxf -c plot --project-id P102 --date 20261025 --drawing-type AP \
    --contractor M4-Contracting --source-crs EPSG:32640 --crs-confirmed --units-confirmed
Job 20261025T133917Z-34d8bd82: Blocked by errors   errors=2 warnings=2 info=2 open_fixes=4
  findings: ADM-CAP-003 (2D POLYLINE), ADM-LYR-006 (not flagged closed), ADM-CAP-005B (bulge), ENG-GEO-003 (colour override)
  proposals: CLOSE_FLAG:145, TO_LWPOLYLINE:14C, DENSIFY_BULGES:158, BYLAYER:158

$ m4adm prepare … --accept-fix all:CLOSE_FLAG --accept-fix all:TO_LWPOLYLINE \
    --accept-fix all:DENSIFY_BULGES --accept-fix all:BYLAYER
Job 20261025T133918Z-614cda80: Ready for review | Official QC not yet performed
  errors=0 warnings=0 info=2
  CLOSE_FLAG:145      vertices 5 -> 4    max shape change 0.0 m
  TO_LWPOLYLINE:14C   lossless           max shape change 0.0 m
  DENSIFY_BULGES:158  vertices 4 -> 29   max shape change 0.00932 m (tolerance 0.01 m)
  BYLAYER:158         properties only
```

"Ready for review" means only that the internal preliminary checks found nothing. The next steps are: convert the file to DWG and run the official ADM QC tool.

## 4. Web UI

`m4adm ui` → http://127.0.0.1:8765. The upload form has category, metadata, CRS/units confirmation and the **Prepare for ADM GIS** button. The job page shows the status badges, the mapping review with re-run, the fix proposals, the pre-export summary, export with acknowledgement, findings, the official QC attachment and the audit log. This flow was verified with Playwright against the same fixture.
