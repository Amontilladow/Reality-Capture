"""Stage H: target drawing generation (DXF R2010, the only CAD format this tool writes).

The target drawing is a NEW document: nothing from the source is copied into it except what a feature carries
(geometry and attribute values). Layers come from the manifest's verified layer table; only layers that hold
features (plus Title) are created. Detail blocks come from a template DXF when one is given (e.g. the official
DRM template saved as DXF); otherwise they are built from the manifest's attribute tables and the report says so -
those are NOT the official template blocks.
"""
from __future__ import annotations

import math
from pathlib import Path

import ezdxf
from ezdxf.addons import importer
from ezdxf.document import Drawing
from shapely.geometry import Point, Polygon
from shapely.ops import polylabel

from m4adm.convert.features import AttrValue, Feature
from m4adm.rules import Manifest

DRAFT_MARK = "M4 CONVERSION DRAFT - NOT REVIEWED - NOT ADM/DRM VALIDATED"


def anchor(poly: Polygon, taken: list[tuple[float, float]], spacing: float = 1.5) -> tuple[float, float]:
    """Insertion point well inside the polygon (official QC key note 5): its pole of inaccessibility. Floor,
    BuildingOutline and Unit share one outline, so a point already used by another block moves along a ring
    around the pole, staying at least 0.5 m (or half the available depth) inside the polygon."""
    pole = polylabel(poly, tolerance=0.01)
    depth = poly.exterior.distance(pole)
    margin = min(0.5, depth / 2)
    inner = poly.buffer(-margin)
    candidates = [(pole.x, pole.y)] + [(pole.x + spacing * k * math.cos(a), pole.y + spacing * k * math.sin(a))
                                       for k in (1, 2, 3) for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)]
    for c in candidates:
        if all(math.dist(c, t) > spacing / 2 for t in taken) and inner.contains(Point(c)):
            return c
    return (pole.x, pole.y)


def _blocks_from_manifest(doc: Drawing, manifest: Manifest, names: set[str]) -> None:
    for name in sorted(names):
        spec = manifest.blocks[name]
        b = doc.blocks.new(name)
        for i, a in enumerate(spec.attributes):
            b.add_attdef(a.tag.upper(), (0, -0.3 * (i + 1)), dxfattribs={"height": 0.2})


def _blocks_from_template(doc: Drawing, template: Path, names: set[str]) -> list[str]:
    src = ezdxf.readfile(str(template))
    have = [n for n in names if n in src.blocks]
    imp = importer.Importer(src, doc)
    imp.import_blocks(have)
    imp.finalize()
    return sorted(names - set(have))


def write_target(path: Path, feats: list[Feature], titles: dict[str, dict[str, AttrValue]], manifest: Manifest,
                 template: Path | None, georeferenced: bool) -> dict:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 6
    doc.header["$LUNITS"] = 2
    doc.header.custom_vars.append("M4_CONVERSION", DRAFT_MARK)
    doc.header.custom_vars.append("M4_GEOREFERENCED", "yes" if georeferenced else "NO - LOCAL COORDINATES")
    specs = {s.name: s for s in manifest.categories["building"].layers}
    exported = [f for f in feats if f.exported]
    used_layers = {f.layer for f in exported} | {specs[f.layer].detail for f in exported if specs[f.layer].detail}
    used_layers.add("Title")
    for name in [s.name for s in manifest.categories["building"].layers if s.name in used_layers]:
        spec = specs[name]
        doc.layers.add(name, color=spec.color, lineweight=spec.lineweight_dxf)
    blocks = {f.block for f in exported if f.block} | set(titles)
    missing_from_template: list[str] = []
    block_source = "manifest attribute tables (NOT the official DRM template blocks)"
    if template is not None:
        missing_from_template = _blocks_from_template(doc, template, blocks)
        block_source = f"template {template.name}"
        if missing_from_template:
            _blocks_from_manifest(doc, manifest, set(missing_from_template))
            block_source += f"; built from the manifest: {', '.join(missing_from_template)}"
    else:
        _blocks_from_manifest(doc, manifest, blocks)
    msp = doc.modelspace()
    written = 0
    placed: list[tuple[float, float]] = []
    for f in exported:
        coords = list(f.poly.exterior.coords)[:-1]
        msp.add_lwpolyline(coords, close=True, dxfattribs={"layer": f.layer})
        detail_layer = specs[f.layer].detail
        if f.block and detail_layer:
            at = anchor(f.poly, placed)
            placed.append(at)
            ref = msp.add_blockref(f.block, at, dxfattribs={"layer": detail_layer})
            ref.add_auto_attribs({k: v.value for k, v in f.attributes.items()})
        written += 1
    # Title frame outside the floor, to the right of everything written.
    if exported:
        x1 = max(f.poly.bounds[2] for f in exported)
        y1 = max(f.poly.bounds[3] for f in exported)
    else:
        x1 = y1 = 0.0
    frame = Polygon([(x1 + 5, y1 - 12), (x1 + 35, y1 - 12), (x1 + 35, y1), (x1 + 5, y1)])
    msp.add_lwpolyline(list(frame.exterior.coords)[:-1], close=True, dxfattribs={"layer": "Title"})
    for k, (name, values) in enumerate(titles.items()):
        ref = msp.add_blockref(name, (x1 + 6 + 15 * k, y1 - 1), dxfattribs={"layer": "Title"})
        ref.add_auto_attribs({t: v.value for t, v in values.items()})
    tmp = path.with_name(path.name + ".tmp")
    doc.saveas(str(tmp))
    tmp.replace(path)
    return {"path": path.name, "features_written": written, "block_source": block_source,
            "layers": sorted(used_layers), "georeferenced": georeferenced, "dxf_version": "R2010 (AC1024)"}
