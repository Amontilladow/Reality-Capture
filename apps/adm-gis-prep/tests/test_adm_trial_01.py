"""ADM QC trial 01: the official QC tool (v2.3) rejected a platform conversion draft with 104 errors.

The expected rows and counts are parsed from the official .err report, never typed in by hand. Two counts differ
by design and are documented (DISCREPANCIES_BDMS B-17, B-18); every other row must match exactly. A corrected
conversion of the same kind of plan must then show none of the C-F error rows.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from m4adm.convert import convert
from m4adm.convert.settings import ConversionSettings
from m4adm.fixtures import arch_floor
from m4adm.io import sha256_file
from m4adm.models import JobSettings
from m4adm.pipeline import prepare
from m4adm.rules import load_profile

ROOT = Path(__file__).resolve().parents[1]
TRIAL = ROOT / "fixtures" / "adm_qc_trial"
DRAFT, ERR = TRIAL / "CONVERSION_DRAFT.dxf", TRIAL / "CONVERSION_DRAFT.err"
ROW = re.compile(r"^\|\s*\d+\s*\|\s*(General|Logical|Attribute) error:\s+(?P<text>.+?)\s*\|\s*(?P<count>\d+)\s*\|"
                 r"(?P<layer>[^|]*)\|\s*$")
TOTAL = re.compile(r"Total Errors found\s*\|\s*(\d+)")

# Rows whose count we do not reproduce exactly, with the discrepancy entry that explains why.
KNOWN_COUNT_DELTAS = {
    ("Incorrect SpaceNumber data entry found in SpaceDetail attribute block", "SpaceDetail"): "B-17",
    ("Incorrect SpaceNumber found in DoorDetail attribute block", "DoorDetail"): "B-18",
}
CATEGORY = {   # brief categories A-F by official error text
    "Incorrect Drawing File Name": "A",
    "No Plot or PlotDetail found": "B",
    "Mismatch Error Missing Attribute Blocks in Polygons": "C",
    "Polygon with missing Attribute Block found": "C",
    "Missing Value in the Attribute Block Mandatory Filed": "D",
    "Incorrect SpaceNumber": "E",
    "Incorrect UsageType data entry": "F",
    "Incorrect UsageCategoryType data entry": "F",
}


def category(text: str) -> str:
    return next(c for prefix, c in CATEGORY.items() if text.startswith(prefix))


def norm(text: str) -> str:
    return " ".join(text.split())


def official_rows() -> dict[tuple[str, str], int]:
    rows = {}
    for line in ERR.read_text(encoding="utf-8", errors="replace").splitlines():
        m = ROW.match(line)
        if m:
            rows[(norm(m["text"]), m["layer"].strip())] = int(m["count"])
    return rows


def our_rows(report: dict) -> dict[tuple[str, str], int]:
    return {(norm(g["qc_error"]), (g["layers"] or [""])[0]): g["count"] for g in report["qc_style_summary"]}


@pytest.fixture(scope="module")
def trial(tmp_path_factory):
    before = sha256_file(DRAFT)
    res = prepare(DRAFT, JobSettings(profile="bdms_building", categories=["building"]),
                  tmp_path_factory.mktemp("trial"), load_profile("bdms_building"))
    assert sha256_file(DRAFT) == before, "the fixture is never modified"
    return res.report


def test_err_file_parses_to_the_official_total():
    rows = official_rows()
    total = int(TOTAL.search(ERR.read_text(encoding="utf-8", errors="replace")).group(1))
    assert len(rows) == 15 and sum(rows.values()) == total == 104
    assert {category(t) for t, _ in rows} == set("ABCDEF")


def test_every_official_row_is_reproduced(trial):
    ours = our_rows(trial)
    missing = [k for k in official_rows() if k not in ours]
    assert not missing, f"official rows our validator does not produce: {missing}"


def test_counts_match_except_documented_deltas(trial):
    ours = our_rows(trial)
    discrepancies = (ROOT / "docs" / "DISCREPANCIES_BDMS.md").read_text(encoding="utf-8")
    for key, count in official_rows().items():
        if key in KNOWN_COUNT_DELTAS:
            assert ours[key] >= 1 and f"| {KNOWN_COUNT_DELTAS[key]} |" in discrepancies, key
            continue
        assert ours[key] == count, f"{key}: official {count}, ours {ours[key]}"


def test_no_official_category_row_is_overcounted_by_unrelated_rules(trial):
    """Rows we report in the official wording but ADM did not are limited to the labelled Title row."""
    official = {t for t, _ in official_rows()}
    extra = {t for t, _ in our_rows(trial) if t not in official}
    assert extra <= {norm("Missing Value in the Attribute Block Mandatory Filed in Title attribute block "
                          "(not reported by the official QC in trial 01)")}


# ------------------------------------------------------------------ corrected conversion: no C-F errors
FULL = dict(single_unit_number="1", floor_height="3.6", building_number_of_floors="2",
            building_usage_category="Commercial", building_usage_type="Single-use Commercial",
            title_values={"DeveloperName": "M4 TEST", "DrawingType": "As Built", "DateOfDrawing": "14-JAN-2026"},
            # unit facts an engineer enters in review (owner data is never derived from a drawing)
            feature_decisions={"UNIT_1": {"action": "accept", "attributes": {
                "UnitType": "Commercial", "UnitClassification": "Office", "UnitNumBedroom": "0",
                "UnitNumBathroom": "2", "UnitUsageType": "Single-use Commercial", "UnitOwnerName": "M4 TEST OWNER",
                "UnitOwnerNatioanlity": "UAE", "UnitOwnerPassport": "TEST0001"}}})


def _c_to_f(report: dict) -> list[dict]:
    rows = report["validation"]["qc_style_summary"]
    return [g for g in rows if any(g["qc_error"].startswith(p) for p, c in CATEGORY.items() if c in "CDEF")]


def test_corrected_synthetic_conversion_has_no_c_to_f_errors(tmp_path):
    src = tmp_path / "plan.dxf"
    arch_floor(shaft=True).saveas(str(src))
    meta = {"zone_name": "SYNTH ZONE", "sector_number": "SE01_01", "plot_number": "C1", "building_number": "1",
            "floor_id": "F1"}
    res = convert(src, ConversionSettings(metadata=meta, **FULL), tmp_path / "jobs")
    assert _c_to_f(res.report) == []
    assert res.report["identifiers_missing"] == []


M19B = (ROOT / "reference" / "DRM_samples" / "Source Files" / "dxf" /
        "M19B-M4C-L1-AX-SD-00145(00)CAD-FIRST FLOOR OVERALL FINISHING LAYOUT.dxf")


@pytest.mark.skipif(not M19B.exists(), reason="M19B source not present (reference/, never committed)")
def test_corrected_m19b_conversion_has_no_c_to_f_errors(tmp_path):
    meta = {"zone_name": "KHALIFA CITY", "sector_number": "SE45_01", "plot_number": "C8", "building_number": "1",
            "floor_id": "F1"}
    res = convert(M19B, ConversionSettings(metadata=meta, **FULL), tmp_path)
    assert _c_to_f(res.report) == [], _c_to_f(res.report)
    assert res.report["output"]["path"] == "KHALIFA CITY-SE45_01-C8-1-F1.dxf"
