"""Regression coverage for the GIS DXF memory-architecture remediation.

identify() used to read the whole file into memory (path.read_bytes()) just
to sniff a handful of header bytes and hash it, before any of the real
DXF-parsing memory cost even begins. It now reads only a 4096-byte header
and reuses the existing streaming sha256_file() -- these tests pin its
observable behaviour (format/version/hash/notes) so that change can never
silently regress, and confirm no full-file read happens any more."""
from __future__ import annotations

import ezdxf

from m4adm.io import identify, sha256_file


def test_identify_ascii_dxf(tmp_path, manifest):
    path = tmp_path / "plain.dxf"
    ezdxf.new("R2010").saveas(str(path))
    ident = identify(path)
    assert ident.format == "DXF-ASCII"
    assert ident.version_code == "AC1024"
    assert ident.release == "AutoCAD 2010-2012"
    assert ident.sha256 == sha256_file(path)  # same hash the old whole-file read would have produced
    assert ident.size == path.stat().st_size


def test_identify_unknown_content(tmp_path):
    path = tmp_path / "not_a_drawing.bin"
    path.write_bytes(b"\x00\x01garbage not cad data" * 10)
    ident = identify(path)
    assert ident.format == "UNKNOWN"
    assert ident.sha256 == sha256_file(path)


def test_identify_flags_mismatched_extension(tmp_path):
    path = tmp_path / "drawing.txt"  # DXF content, wrong extension
    ezdxf.new("R2010").saveas(str(path))
    ident = identify(path)
    assert ident.format == "DXF-ASCII"
    assert any("extension" in n for n in ident.notes)


def test_identify_never_reads_the_whole_file(tmp_path, monkeypatch):
    """The specific regression this fix closes: identify() must not call
    Path.read_bytes() (a full-file read) at all -- only a bounded header
    read plus the already-streaming sha256_file()."""
    path = tmp_path / "plain.dxf"
    ezdxf.new("R2010").saveas(str(path))

    from pathlib import Path as PathCls

    def _forbidden(self, *a, **kw):
        raise AssertionError("identify() must not read the whole file into memory")

    monkeypatch.setattr(PathCls, "read_bytes", _forbidden)
    identify(path)  # would raise AssertionError if it still called read_bytes()


def test_prepare_with_three_categories_still_matches_single_category_output(run, manifest):
    """Pins pipeline.py's `del doc, records2, ctx, specs` + gc.collect() (added
    so a multi-category job doesn't hold the full document and every
    intermediate structure through every category's own full re-read) to
    the SAME per-category output a single-category run produces -- the fix
    must change memory lifetime only, never which entities land where."""
    import m4adm.fixtures as fx

    single = run(fx.mixed(manifest), ["plot"])
    multi = run(fx.mixed(manifest), ["plot", "roads", "services"])
    plot_single = next(o for o in single.report["outputs"] if o["dataset"] == "plot")
    plot_multi = next(o for o in multi.report["outputs"] if o["dataset"] == "plot")
    assert plot_single["entities"] == plot_multi["entities"]
    assert plot_single["verification"]["ok"] and plot_multi["verification"]["ok"]
