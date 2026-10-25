"""The rule manifest is the single source of truth and must match the PDF tables."""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from m4adm.matrix import ROOT, render_matrix
from m4adm.models import Evidence
from m4adm.rules import Manifest, load_manifest, rules_dir

SRC = Path(__file__).resolve().parents[1] / "src" / "m4adm"


def test_manifest_loads_with_version_and_pdf_hash(manifest):
    assert manifest.version == "1.18.2"
    assert manifest.spec["source_pdf_sha256"] == "125f11229da7bfcdeb47b8757e6622f940bb14e09fd6cbdbcc4f459a03e8b2fd"
    assert len(manifest.sha256) == 64


def test_every_rule_has_exactly_one_valid_evidence_class(manifest):
    for r in manifest.rules:
        assert isinstance(r.evidence, Evidence)
        if r.evidence == Evidence.VERIFIED_SPEC:
            assert r.ref is not None and r.ref.page is not None, f"{r.id} is VERIFIED_SPEC without a PDF page"


def test_every_rule_id_used_in_code_exists_in_manifest(manifest):
    used = set()
    pat = re.compile(r'"((?:ADM|ENG|USR|PND|M4)-[A-Z0-9]+-[A-Z0-9]+)"')
    for f in SRC.rglob("*.py"):
        used |= set(pat.findall(f.read_text(encoding="utf-8")))
    missing = used - set(manifest.rule_index)
    assert not missing, f"rule ids used in code but not in manifest: {missing}"


@pytest.mark.parametrize("category,count", [("plot", 8), ("roads", 46), ("services", 15)])
def test_layer_counts_match_pdf_tables(manifest, category, count):
    # Table 5 (8 rows), Table 6 (46 rows), Table 7 (15 rows)
    assert len(manifest.layers_for(category)) == count


@pytest.mark.parametrize("category,name,color,linetype,lw", [
    ("plot", "Plot", 51, "Continuous", -3),
    ("plot", "Sector", 3, "Continuous", 30),
    ("plot", "Zone", 7, "Continuous", 40),
    ("roads", "RoadCenterLine", 6, "Dashed", -3),
    ("roads", "RoadLayBy", 43, "Continuous", -3),
    ("roads", "RoadlayByDetail", 43, "Continuous", -3),
    ("roads", "CyclingJoggingTrackDetail", 234, "Continuous", -3),
    ("roads", "RailRoadEdgeDetail", 133, "Continuous", -3),
    ("roads", "RailRoadCenterline", 161, "Track", -3),
    ("roads", "RailRoadCenterlineDetail", 161, "Continuous", -3),
    ("services", "ServiceCorridor", 2, "Continuous", 30),
    ("services", "BoreHole", 30, "Continuous", -3),
    ("services", "BufferZone", 4, "Continuous", -3),
])
def test_layer_properties_match_pdf(manifest, category, name, color, linetype, lw):
    spec = manifest.layer(category, name)
    assert spec is not None
    assert (spec.color, spec.linetype, spec.lineweight_dxf) == (color, linetype, lw)


def test_closed_and_open_constraints(manifest):
    assert manifest.layer("roads", "RoadEdge").constraint == "none"
    assert manifest.layer("roads", "RoadCenterLine").constraint == "none"
    assert manifest.layer("roads", "RailRoadEdge").constraint == "none"
    assert manifest.layer("roads", "RoadEntrance").is_closed
    assert manifest.layer("services", "BoreHole").standalone_point


def test_detail_blocks_resolve_and_have_attributes(manifest):
    for cat in manifest.categories:
        for spec in manifest.layers_for(cat):
            if spec.is_detail:
                assert spec.block in manifest.blocks
                assert manifest.blocks[spec.block].attributes


def test_domains_are_case_sensitive_lists(manifest):
    assert manifest.domain_values("medium") == ["surface", "air", "underground", "semiBuried", "undefined"]
    assert "Car" in manifest.domain_values("parking_for")  # capital C exactly as printed on p.20
    assert manifest.domain_values("yes_no") == ["Yes", "No"]


def test_plot_usage_appendix_extracted(manifest):
    assert sum(len(v) for v in manifest.plot_usage.values()) == 1218
    assert "villa" in manifest.plot_usage["residential"]
    assert "Community Center -" in manifest.plot_usage["publicBuilding"]


def test_manifest_rejects_duplicate_rule_ids(tmp_path):
    data = yaml.safe_load((rules_dir() / "adm_v1.18.2.yaml").read_text(encoding="utf-8"))
    data["rules"].append(dict(data["rules"][0]))
    with pytest.raises(ValueError, match="duplicate rule ids"):
        Manifest(**data)


def test_manifest_rejects_plot_usage_from_other_pdf(tmp_path):
    src = rules_dir()
    (tmp_path / "adm_v1.18.2.yaml").write_text((src / "adm_v1.18.2.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    usage = yaml.safe_load((src / "adm_v1.18.2_plot_usage.yaml").read_text(encoding="utf-8"))
    usage["source_pdf_sha256"] = "0" * 64
    (tmp_path / "adm_v1.18.2_plot_usage.yaml").write_text(yaml.safe_dump(usage), encoding="utf-8")
    with pytest.raises(ValueError, match="different PDF"):
        load_manifest(path=tmp_path / "adm_v1.18.2.yaml")


def test_compliance_matrix_is_up_to_date(manifest):
    path = ROOT / "docs" / "COMPLIANCE_MATRIX.md"
    assert path.read_text(encoding="utf-8") == render_matrix(manifest), "run `m4adm matrix`"
