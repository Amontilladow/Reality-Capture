# Local reference material (not committed)

Put official documents and real drawings here. Everything in this folder except this README is git-ignored:
client drawings and ADM/DRM documents must stay local.

Expected layout for the reference tests (`tests/test_reference_drm.py`, self-skipping when absent):

```
reference/DRM_samples/ADM Specs/...           BDMS 4.1 spec, templates, QC tool + manual, UPC xls
reference/DRM_samples/GIS Drawings/dxf/*.dxf  ADM-approved (QC-passed) GIS drawings
reference/DRM_samples/Source Files/dxf/*.dxf  original M4 drawings
```
Override the location with `M4ADM_REFERENCE_DIR`.
