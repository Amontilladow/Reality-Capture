# Architecture and limitations

## Pipeline

```
source.dxf (read-only)
   │  copy byte-for-byte → <job>/input (chmod 444, SHA-256 verified)
   ▼
io.identify ──► DWG / unknown → blocking finding M4-IN-001, no output
   ▼
io.load_dxf (ezdxf recover mode; repairs in memory only → ENG-FILE-001)
   ▼
classify   every model-space entity: real structure (LWPOLYLINE / POLYLINE2D / POLYLINE3D /
           POLYMESH / POLYFACE / INSERT …), bulges, widths, elevation, thickness, OCS,
           block name, attributes, xref, missing block def, property overrides
   ▼
mapping    VERIFIED_NAME | ALIAS (PDF spelling) | CASE_VARIANT | USER_ACCEPTED |
           OUT_OF_SCOPE | UNRESOLVED → review queue (never colour/position based)
   ▼
crs        declaration + confirmation gate; plausibility window; optional explicit,
           confirmed, logged transformation
   ▼
fixes      only accepted proposals (CLOSE_FLAG, TO_LWPOLYLINE, DENSIFY_BULGES, BYLAYER)
   ▼
validate   filename/metadata · units · hygiene · entity role · layer table · title ·
           per-feature geometry · per-layer topology · attribute association & content ·
           services rules        → Findings (rule id, severity, evidence, PDF ref,
                                    handle, layer, location, next action)
   ▼
export     work/prepared_full.dxf → one DXF per dataset + additional file;
           layer-table normalisation, unused-block omission, provisional header tags,
           R2010; re-read and verify each output (handles, audit)
   ▼
report     qc_report.json/html · processing_manifest.json · geometry_log.json ·
           review_queue.json · audit.jsonl · README.txt → atomic rename <id>.partial → <id>
```

## Modules (`src/m4adm`)

| Module | Responsibility |
|---|---|
| `io` | Identify the format from the file content (DXF ASCII/binary, DWG version code, release ≤ 2012), hash, recover-mode loading |
| `classify` | Entity records, referenced/unused blocks, unused linetypes, xrefs |
| `crs` | CRS gate, plausibility window, confirmed transformation |
| `geometry` | Shapely conversion, exact arc densification; `geometry.fixes` holds the opt-in fix proposals and their application |
| `mapping` | Layer index, mapping decisions, name hints |
| `rules` | Manifest schema (pydantic), loader, consistency validation |
| `validate` | `Collector`; `filename`, `drawing`, `features` checks |
| `export` | Job workspace, atomic writes, dataset outputs, verification |
| `report` | HTML report template |
| `audit` | Append-only JSONL with fsync |
| `adapters` | DWG converter (ODA), official template comparison, official QC (interface only) |
| `jobs` | Run history, export package, attaching official QC output |
| `ui` | FastAPI app and templates (127.0.0.1) |
| `cli`, `pipeline`, `matrix`, `fixtures` | Entry points, orchestration, generated compliance matrix, synthetic data |

## Rules engine

Every check calls `Collector.add(rule_id, …)`. The evidence class, default severity and PDF reference are always taken from the manifest, so a check cannot promote its own evidence class. A test asserts that every rule id used in code exists in the manifest.

To support a new specification version, add `rules/adm_v<new>.yaml` (and regenerate the Appendix 2 file with `scripts/extract_plot_usage.py`). Changes to layer names, colours, blocks, attributes, domains or tolerances need no code changes. Every run records the spec version and the manifest's SHA-256.

## DWG strategy (brief E3)

| Option | Licensing / cost | Deployment | Compatibility | Status |
|---|---|---|---|---|
| 1. Licensed SDK: Autodesk RealDWG, ODA Drawings SDK | Paid annual membership (ODA) or paid Autodesk licence (RealDWG); C++/.NET | Build an SDK binding; per-seat/runtime terms | Native DWG read/write, any release | **Not used**: paid (hard stop A4(e)); needs approval |
| 2. Installed AutoCAD (already licensed at M4) | No extra cost if seats exist | Run `accoreconsole.exe` with a script: `DXFIN` → `SAVEAS 2010` (or 2007/2004); the official `.FAS` can be `APPLOAD`ed in the same session | Exact AutoCAD behaviour | **Recommended next step**: this is also the only supported way to run the official QC tool |
| 3. ODA File Converter (free download, ODA licence terms; GUI + CLI) | Free to use; check the ODA licence terms for commercial internal use | Install per PC; set `M4ADM_ODA_CONVERTER` | DXF↔DWG, ACAD2010 output | **Adapter implemented and untested** (`adapters.DWGConverter`); not installed here, so DWG conversion is **not claimed to work** |
| DXF-first (current) | None | pip | AutoCAD 2010-2012 opens R2010 DXF | **Implemented and tested** |

**Next step for DWG:** on one M4 workstation with AutoCAD 2012 or later, add `adapters.AutoCADConsole`. It writes a `.scr` that opens each prepared DXF and saves it as an AutoCAD 2010 DWG with the validated name, then re-hashes the result. Test it against one real drawing, then make it the default export path. Optionally run the official QC `.FAS` in the same console session and archive its report through `attach-qc`.

## Limitations (disclosed in every report)

1. Output is DXF, not DWG. See above.
2. **No official ADM template.** The title block name, attribute block definitions (prompts, order, flags), dimension style and the `Track` linetype are unknown. They are checked against the PDF tables only and never fabricated. ADM-TTL-001 detection relies on Table 4 attribute tags.
3. **No official QC tool (.FAS) or manual.** Its exact checks, tolerances and messages are unknown. The internal report is a preliminary QC and does not predict the official result.
4. **No paired real/accepted drawings.** Tolerances (coincidence 1 mm, snap search 50 mm, zero length 1 mm, overlap 0.0001 m², sagitta 10 mm) are M4 defaults. They are configurable and reported with every run.
5. The CRS cannot be read from a DXF; it relies on the engineer's confirmed declaration. The plausibility window is only a warning.
6. Topology checks run within a layer. Cross-layer checks are limited to those the PDF states (corridors vs plots, boreholes in activity areas, strips in corridors).
7. Self-intersection locations for very long open polylines (>2,000 vertices) fall back to the first vertex.
8. Paper space is not checked (reported as INFO).
9. Data-entry heuristics (special or repeated characters, Arabic/English script) are warnings only.
10. Performance has been tested only on synthetic drawings (tens of entities). STRtree indexing is used throughout, but large real drawings (100k+ entities) have not been benchmarked.
