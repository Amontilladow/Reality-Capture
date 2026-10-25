"""File name and metadata validation (spec §4.2)."""
from __future__ import annotations

import pytest

from m4adm.models import Metadata, Severity
from m4adm.validate import Collector
from m4adm.validate.filename import build_stem, validate_filename, validate_metadata, validate_stem


def _ids(col):
    return {f.rule_id for f in col.findings if f.severity == Severity.ERROR}


@pytest.mark.parametrize("name", [
    "P11_20130707_AP_Plot_ADM.dwg", "P21_20131007_AP_Roads_ADM.dwg", "P21_20131007_AP_Services_ADM.dwg",
    "P101_20130707_MP_Plot_ADM.dwg", "P101_20130707_MP_Roads_ADM.dwg", "P101_20130707_MP_Services_ADM.dwg",
    "P101_20130707_MP_additional_ADM.dwg",
])
def test_pdf_examples_are_valid(manifest, name):
    col = Collector(manifest)
    assert validate_filename(name, col)
    assert not col.findings


@pytest.mark.parametrize("name,rule", [
    ("P11_20130707_AP_Plot.dwg", "ADM-NAME-001"),
    ("P_11_20130707_AP_Plot_ADM.dwg", "ADM-NAME-001"),
    ("<P11>_20130707_AP_Plot_ADM.dwg", "ADM-NAME-007"),
    ("P 11_20130707_AP_Plot_ADM.dwg", "ADM-NAME-002"),
    ("P11_2013077_AP_Plot_ADM.dwg", "ADM-NAME-003"),
    ("P11_20131307_AP_Plot_ADM.dwg", "ADM-NAME-003"),
    ("P11_20130230_AP_Plot_ADM.dwg", "ADM-NAME-003"),
    ("P11_20130707_XP_Plot_ADM.dwg", "ADM-NAME-004"),
    ("P11_20130707_AP_plot_ADM.dwg", "ADM-NAME-005"),
    ("P11_20130707_AP_Parcels_ADM.dwg", "ADM-NAME-005"),
    ("P11_20130707_AP_Plot_DMT.dwg", "ADM-NAME-006"),
    ("P11_20130707_AP_Plot_ADM.dxf", "ADM-NAME-009"),
])
def test_invalid_names_report_specific_rule(manifest, name, rule):
    col = Collector(manifest)
    assert not validate_filename(name, col)
    assert rule in _ids(col)
    assert all(f.action for f in col.findings), "every failure must state the corrective action"


def test_case_hint_for_dataset_token(manifest):
    col = Collector(manifest)
    validate_stem("P11_20130707_AP_roads_ADM", col)
    assert "use 'Roads'" in col.findings[0].action.lower() or "'Roads'" in col.findings[0].action


def test_build_stem_from_metadata():
    meta = Metadata(project_id="P101", submission_date="20261025", drawing_type="MP", spec_type="ADM")
    assert build_stem(meta, "Plot") == "P101_20261025_MP_Plot_ADM"


def test_master_plan_requires_all_three_themes(manifest):
    col = Collector(manifest)
    validate_metadata(Metadata(drawing_type="MP", consultant_name="X"), ["plot", "roads"], col)
    assert "ADM-NAME-008" in _ids(col)
    col = Collector(manifest)
    validate_metadata(Metadata(drawing_type="MP", consultant_name="X"), ["plot", "roads", "services"], col)
    assert "ADM-NAME-008" not in _ids(col)


def test_metadata_needs_consultant_or_contractor(manifest):
    col = Collector(manifest)
    validate_metadata(Metadata(drawing_type="AP"), ["plot"], col)
    assert any(f.rule_id == "ADM-TTL-002" for f in col.findings)
