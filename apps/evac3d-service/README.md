# evac3d-service

Private service behind the **3D Evacuation Plans** module ("Convert" button).
It runs the conversion engine in [`tools/evacuation-3d`](../../tools/evacuation-3d)
on a batch of 2D evacuation-plan PDFs and returns the package (combined PDF,
one PDF/SVG/preview/glTF per sheet, `report.json`).

| Endpoint | |
|---|---|
| `POST /jobs` | multipart `drawings` (PDFs), optional `logo` (PNG/JPG), `settings` (JSON) -> `{id}` |
| `GET /jobs/{id}` | status (`queued`/`running`/`done`/`failed`) and per-sheet progress |
| `GET /jobs/{id}/result` | finished package as a zip (`X-Evac3d-Status` header) |
| `DELETE /jobs/{id}` | remove the job's files |

Every request needs `X-Internal-Service-Secret` (same value as engineeringos-api).
One batch runs at a time; each sheet's model build and render run in their own
process. A large sheet peaks at about 1.5 GB, so give the instance 2-4 GB.
Job state is on local disk only: after a restart `GET` returns 404 and the API
queue resubmits the job.

Tests (stand-in engine): `pip install -r requirements-dev.txt && pytest tests`.
