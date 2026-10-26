# Technical report

## Milestone 2 (2026-10-26): DRM BDMS 4.1 calibration and strict mode

- The material M4 supplied (BDMS 4.1 spec, QC tool DRM_CPDQC_V2.3 + manual, templates, UPC code list, 4 accepted floor drawings, 5 original M4 drawings) is for **building-floor (BDMS) submissions**. A second profile, `bdms_building`, was added (62 rules). Every rule is mapped to its official QC error wording; generic checks are shared through profile aliases.
- **Calibration:** all 4 drawings that passed official QC give **0 errors**, and their prepared files are identical in content to the originals. The remaining warnings are genuine spec-rule-1 deviations that the official QC does not check: edge crossings, 0.9–4 mm near-miss snaps, repeated vertices, one overhanging space, one trailing space. See CALIBRATION.md and DISCREPANCIES_BDMS.md.
- **Strict mode (default):** any error or warning blocks *Ready for review*, as requested ("let's not pass any check, big or small").
- **Control-point georeferencing:** least-squares similarity transform with residuals and a 0.05 m RMS gate. It is only applied with explicit confirmation, is exact for polylines and blocks, and is tested end to end with a synthetic floor moved to local mm and back.
- **Submission files:** model space only. Specified-but-empty and unspecified layers are removed, unreferenced anonymous blocks are omitted, and reader repairs are grouped.
- **Tests:** `python -m pytest`: **200 passed**, 0 failed, 0 skipped (including 5 reference tests on the real samples, which self-skip in CI where the samples are absent).
- **Still not automated:** turning architectural wall lines and room labels into Space, Door and Window polygons. The original L1 drawing correctly comes out *Blocked*, with an exact list of what to draw.
- **Still needed:** templates saved as DXF; `.err` reports from running the official QC on the tool's outputs; DRM's zone/sector lists; answers on DISCREPANCIES_BDMS.

## Milestone 1: DXF-first MVP

## Works and is tested

- **Input**: the format is identified from the file content (ASCII/binary DXF; DWG with its version code), the release is checked against AutoCAD 2012, and damaged DXFs load in recover mode.
- **Source protection**: the source is copied read-only and its SHA-256 and mtime are verified after the run. Tests run all 12 fixtures with every fix accepted and confirm the source hash, entity list and mtime are unchanged.
- **Rule manifest**: 80 rules (VERIFIED_SPEC 56, ENGINEERING_CHECK 13, PENDING_OFFICIAL_CONFIRMATION 7, USER_DECISION_REQUIRED 4; implementation: 67 IMPLEMENTED, 10 PARTIAL, 2 INTERFACE_ONLY, 1 NOT_IMPLEMENTED (ADM-TTL-004)), Tables 5-7 with all 69 layer rows, 32 attribute blocks with domains, and Appendix 2 extracted by script and bound to the PDF hash.
- **Mapping**: verified names, PDF aliases, case variants, accepted layer and handle mappings, review queue with unverified name hints, out-of-scope layers sent to the additional file.
- **Checks**:
  - File name and metadata, including the MP three-theme rule.
  - Units, with engineer confirmation.
  - CRS gate and plausibility window.
  - Prohibited, curve, 3D, text and proxy entities, evaluated by role (attribute INSERTs are not treated as prohibited; 2D, 3D and mesh POLYLINEs are told apart).
  - Layer table properties, title block, closure, zero length, repeated vertices, degenerate polygons, self-intersection, duplicates, overlaps, islands (with the ToBeClipped exception), vertex snapping, snapping on edges, undershoots, overshoots and crossings.
  - Attribute insertion inside polygons or on line vertices (not at shared vertices), one block per feature, block names, tags, mandatory values, domains (case-sensitive), data types, dates, conditional rules, maximum length and Appendix 2 dependency.
  - Services: corridors versus plots, boreholes inside activity areas, strips inside corridors.
- **Fixes** are opt-in and logged: CLOSE_FLAG, TO_LWPOLYLINE, DENSIFY_BULGES (deviation ≤ tolerance, original vertices kept) and BYLAYER.
- **Export**: per-dataset R2010 DXF with the validated ADM stem, layer-table normalisation, unused-block omission and provisional header tags. Every output is re-read and checked for an exact handle set. Writes are atomic, and failed jobs become `*.failed` with `error.json`.
- **Reader repairs**: an object that the DXF reader has to drop (e.g. an INSERT whose block is missing) becomes an ADM-CAP-010 ERROR and is listed as rejected in the geometry log, so it can never disappear silently.
- **Reports**: JSON and HTML QC reports, processing manifest, geometry log, review queue and JSONL audit trail. Export requires a name and an acknowledgement. Official QC output can be attached.
- **UI**: upload/select, categories, metadata, CRS/units confirmation, tolerances, mapping review with re-run, fix acceptance, pre-export summary, export, official QC attachment, run history and audit log. Verified in a real browser (Playwright).

**Test results (actual):** `python -m pytest`: **165 passed**, 0 failed, 0 skipped, in about 12 s (Python 3.13.17, Linux). Every rule except ADM-TTL-004 (not implemented) has at least one test asserting on its id. The suite covers the manifest, filename, geometry including tolerance boundaries, attributes, CRS, mapping, integrity and audit, UI and CLI. A mutation spot-check (disabling the zero-length check, and making the input copy writable) made the corresponding tests fail as expected.

## Not available or not tested (do not rely on these)

| Item | State |
|---|---|
| DWG output | **Not produced.** The ODA adapter is coded but **untested** (converter not installed). AutoCAD console conversion is the recommended next step. |
| DWG input | Identified and blocked with instructions. Not read. |
| Official ADM template | **Missing.** Only the comparison adapter exists. Title and attribute blocks are never fabricated. The `Track` linetype is not created. |
| Official QC `.FAS` and manual | **Missing.** Not emulated. Status stays "Official QC not yet performed" until a real report is attached. |
| Real drawings | **None available.** Tested on synthetic data only, and not benchmarked on large drawings. |

## Dependency and licensing blockers

- None for the MVP: all dependencies are open source (MIT, BSD or Apache) and pinned.
- DWG needs one of the following: AutoCAD (existing M4 seats, no new cost), ODA File Converter (free download, check ODA terms for commercial use), or a paid SDK (ODA, RealDWG). The paid SDKs were not added (hard stop A4(e)).
- The repository's `CLAUDE.md` asks for `graphify update .`, but graphify is not installed and `graphify-out/` does not exist in this repo, so it was skipped.

## Next recommended milestone

1. **DWG via AutoCAD console** on one licensed workstation: write the prepared DXF as an AutoCAD 2010 DWG, plus an optional official QC run in the same session.
2. **Official template integration**, as soon as ADM supplies it: copy layer, block, linetype and dimension style definitions from the template, and resolve the PENDING rules.
3. **Calibrate on 3 real paired drawings**: tolerances, a mapping library, and a regression suite.
