"""Drawings the converter could not read before: walls on a layer no default pattern matches (a key plan keeps
everything on one layer), and a header that names the wrong unit."""
from __future__ import annotations

import pytest

from m4adm.convert import ConversionSettings, convert
from m4adm.fixtures import arch_floor

META = {"zone_name": "ZZ", "sector_number": "S1", "plot_number": "P1", "building_number": "1", "floor_id": "G"}


def _run(tmp_path, doc, **settings):
    tmp_path.mkdir(parents=True, exist_ok=True)
    src = tmp_path / "plan.dxf"
    doc.saveas(src)
    return convert(src, ConversionSettings(metadata=META, single_unit_number="1", **settings), tmp_path / "jobs")


def _rename_layers(doc, old, new):
    for e in doc.modelspace():
        if e.dxf.layer == old:
            e.dxf.layer = new
    return doc


def test_wall_layer_setting_finds_walls_on_an_unusual_layer(tmp_path):
    doc = _rename_layers(arch_floor(), "A-200-M_WALL", "A-ARCH-KEYPLAN")
    blocked = _run(tmp_path / "a", doc)
    text = " ".join(blocked.report["blockers"])
    assert "No wall geometry found" in text and "A-ARCH-KEYPLAN" in text        # names the layers that hold geometry
    ok = _run(tmp_path / "b", _rename_layers(arch_floor(), "A-200-M_WALL", "A-ARCH-KEYPLAN"),
              wall_layers=[" A-ARCH-KEYPLAN "])
    assert not any("wall" in b.lower() for b in ok.report["blockers"]), ok.report["blockers"]


def test_wrong_header_units_are_called_out_not_reported_as_empty_walls(tmp_path):
    # The plan is 12 x 8 m drawn in millimetres. Declaring metres inflates it 1000-fold, declaring nothing wrong passes.
    res = _run(tmp_path / "big", arch_floor(units=6))                               # header says metres
    assert any("not a plausible building floor" in b for b in res.report["blockers"]), res.report["blockers"]
    fine = _run(tmp_path / "fine", arch_floor(units=4))                             # header says mm, correct
    assert not any("plausible" in b for b in fine.report["blockers"])


def test_declared_units_override_a_wrong_header(tmp_path):
    res = _run(tmp_path, arch_floor(units=6), source_units="mm")
    assert not any("plausible" in b for b in res.report["blockers"]), res.report["blockers"]


def test_wall_layers_do_not_touch_the_other_roles():
    s = ConversionSettings(wall_layers=["X"])
    assert s.roles["wall"] == ["X"] and "*GLAZ*" in s.roles["window"]
    assert "*WALL*" in ConversionSettings().roles["wall"]
