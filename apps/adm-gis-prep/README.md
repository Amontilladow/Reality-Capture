# M4 ADM GIS Preparation

An internal M4 Contracting tool. It prepares CAD drawings for GIS submission and produces a *preliminary* QC report. Two submission standards ("profiles") are supported:

- **`sdd_planning`**: ADM SDD *Standards & Specifications for Planning Data Submission* v1.18.2 (Plot, Roads, Services / Service Corridors).
- **`bdms_building`**: DRM *Building Data Delivery Specification (BDMS 4.1)*, one building floor per file. It is checked against the rules of the official QC tool DRM_CPDQC_V2.3 and **calibrated on four drawings that passed official QC (0 errors on each)**. See [docs/CALIBRATION.md](docs/CALIBRATION.md).

**Strict mode** is on by default: any error *or* warning blocks a job.

> **PROVISIONAL: NOT ADM-VALIDATED.** The internal QC report is not ADM approval. Acceptance comes only from ADM's official QC tool and review.

What the tool does:
- Identifies the input's real format and copies it read-only into a job folder. The original is SHA-256 verified before and after every run.
- Maps layers deterministically when the name is unambiguous. All other layers go to a review queue; the tool never infers meaning from colour or position.
- Runs the verified ADM rules from a versioned manifest (`rules/adm_v1.18.2.yaml`, 80 SDD rules + 62 BDMS rules, all layer tables, 32 attribute blocks, Appendix 2 with 1,218 rows). Each finding is traceable to a handle, a location and a PDF page.
- Applies only the fixes the engineer accepts, and logs each one.
- Writes one DXF (R2010) per dataset plus an `additional` file, then re-reads and verifies every output.
- Produces JSON and HTML reports, a processing manifest, a geometry log and an audit trail.
- Offers a CLI and a local web UI (127.0.0.1 only). The main button is **Prepare for ADM GIS**.

Quick start: see [docs/SETUP.md](docs/SETUP.md) and [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

| Document | Content |
|---|---|
| [docs/COMPLIANCE_MATRIX.md](docs/COMPLIANCE_MATRIX.md) | SDD profile: every rule with evidence class, PDF page, implementation, tests, limitations (generated) |
| [docs/COMPLIANCE_MATRIX_BDMS.md](docs/COMPLIANCE_MATRIX_BDMS.md) | BDMS profile: every rule with the official QC error text it corresponds to (generated) |
| [docs/CALIBRATION.md](docs/CALIBRATION.md) | Calibration on the DRM material: accepted drawings, originals, results |
| [docs/DISCREPANCIES_BDMS.md](docs/DISCREPANCIES_BDMS.md) | Where the BDMS text, the QC manual and the accepted drawings disagree |
| [docs/DISCREPANCIES.md](docs/DISCREPANCIES.md) | Where the PDF contradicts itself or the brief |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Design decisions and alternatives |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Pipeline, modules, DWG strategy, limitations |
| [docs/INTEGRATION_PLAN.md](docs/INTEGRATION_PLAN.md) | Official files M4 must obtain, and how each plugs in |
| [docs/SAMPLE_RUN.md](docs/SAMPLE_RUN.md) | End-to-end run on synthetic data |
| [docs/TECHNICAL_REPORT.md](docs/TECHNICAL_REPORT.md) | What works, what is tested, what is blocked |
| [fixtures/](fixtures/) | Synthetic DXFs, **not official ADM samples** |
