# Setup

The tool runs on one engineering PC (Windows, macOS or Linux). It needs no AutoCAD, no internet connection after installation, and no cloud services.

## Requirements

- Python 3.12 or newer (tested with 3.13; pyproj 3.8.0 does not install on 3.11).
- Disk space for job folders: roughly 3-5 times the size of each drawing per run.

## Install

```bash
cd apps/adm-gis-prep
python -m venv .venv
# Windows: .venv\Scripts\activate     macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
m4adm --version
```

The install must be editable (`-e`) because the package reads `rules/` from the app folder. To keep the rules elsewhere, set `M4ADM_RULES_DIR`.

## Verify

```bash
python -m pytest            # full suite
m4adm matrix --check        # compliance matrix matches the manifest
m4adm fixtures /tmp/fx && m4adm inspect /tmp/fx/SYNTHETIC_mixed.dxf
```

## Run

- Web UI: `m4adm ui --workspace D:\M4-GIS\workspace`, then open http://127.0.0.1:8765. It listens on 127.0.0.1 only.
- CLI: see [USER_GUIDE.md](USER_GUIDE.md).

## Optional integrations

| Item | How | Status |
|---|---|---|
| DWG input: ODA File Converter | Install from opendesign.com (free; check licence terms), set `M4ADM_ODA_CONVERTER=C:\Program Files\ODA\ODAFileConverter <ver>\ODAFileConverter.exe` | DWG input is converted to DXF automatically before checking. Validate once with `python -m pytest tests/test_reference_drm.py` (fidelity test against AutoCAD's own DXF) |
| DWG input: LibreDWG | Install LibreDWG (open source, GPL; used only as a separate program), set `M4ADM_DWG2DXF=<path to dwg2dxf>` or put it on PATH | Same as above; ODA is preferred when both are installed |
| Official ADM template | Save as DXF 2010; pass `--template` | Comparison only (see INTEGRATION_PLAN) |
| ADM PDF | Place it in `reference/` (git-ignored). Needed only to regenerate Appendix 2: `python scripts/extract_plot_usage.py reference/<pdf> rules/adm_v1.18.2_plot_usage.yaml` (needs `pdftotext`) | - |

## Reality Capture module (cloud)

The same engine also runs inside the Reality Capture platform as **GIS Preparation**: it is in the project sidebar under Engineering, at `/projects/:id/gis-prep`. To avoid a paid instance for a job that runs a few times a year, it is hosted **inside the existing AI service** (D-034), not as its own service.

| Part | Where |
|---|---|
| Engine | Installed in its own virtualenv `/opt/m4adm` in the `engineeringos-ai-service` image (`apps/ai-service/Dockerfile`, built from the repo root) |
| Endpoint | `POST /gis-prep/prepare` in `apps/ai-service/app/routers/gis_prep.py`. It runs `python -m m4adm.package` as a separate process |
| API | `apps/api/src/modules/gis-prep` (Bull queue `gis-prep`), table `gis_prep_jobs` (migration 076); `GIS_PREP_SERVICE_URL=http://engineeringos-ai-service:8001/gis-prep` |
| Web | `apps/web/src/pages/GisPrepPage.tsx` |

The AI service has 512 MB of memory. These limits keep a GIS job from crashing it, and with it the AI assistant:

| Setting (AI service env) | Default | Effect |
|---|---|---|
| `GIS_PREP_MAX_UPLOAD_MB` | 25 | Larger drawings are refused before processing |
| `GIS_PREP_MEMORY_LIMIT_MB` | 320 | Memory cap of the engine process; over it, the job fails with "use the desktop tool" |
| `GIS_PREP_TIMEOUT_S` | 840 | Longer runs are stopped |

Only one GIS job runs at a time.

Measured peak memory:
- Drawings already in DRM GIS format (e.g. the accepted Khalifa City floors): about 90 MB. These work in the cloud.
- Raw architectural originals: 280–670 MB. These are refused in the cloud. Use the desktop tool for them.

Each job stores its package at `<company>/gis-prep/<project>/<job>/`. That covers the prepared DXFs, `qc_report.*`, `processing_manifest.json`, `geometry_log.json`, `audit.jsonl` and `package.zip`. The uploaded original is never changed. A re-run with layer-mapping decisions creates a new job on the same original. The image bundles no DWG converter, so DWG uploads come back blocked with the reason.

`src/m4adm/service.py` and `Dockerfile` remain as a standalone service (port 8002) in case GIS work ever moves to its own instance.
