# Setup

The tool runs on one engineering PC (Windows, macOS or Linux). It needs no AutoCAD, no internet connection after installation, and no cloud services.

## Requirements

- Python 3.11 or newer (tested with 3.13).
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
