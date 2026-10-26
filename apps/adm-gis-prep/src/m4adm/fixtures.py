"""Synthetic DXF fixtures for tests and demonstrations.

SYNTHETIC, NOT AN OFFICIAL ADM SAMPLE. Block definitions here are built from the PDF
attribute tables purely so the tool has something to check; they are not the official
template blocks and must never be used in a submission.
"""
from __future__ import annotations

from pathlib import Path

import ezdxf
from ezdxf.document import Drawing

from m4adm.rules import Manifest, load_manifest

SYNTHETIC_LABEL = "SYNTHETIC, NOT AN OFFICIAL ADM SAMPLE"
# A location inside Abu Dhabi city in WGS 84 / UTM 40N (approx. 54.37E 24.45N).
E0, N0 = 233_000.0, 2_705_000.0
TITLE_BLOCK = "SYNTHETIC_TITLE"


def new_doc(manifest: Manifest, categories: tuple[str, ...] = ("plot", "roads", "services"),
            spec_layers: bool = True) -> Drawing:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 6
    doc.header["$LUNITS"] = 2
    doc.header.custom_vars.append("SYNTHETIC", SYNTHETIC_LABEL)
    if spec_layers:
        for cat in categories:
            for spec in manifest.layers_for(cat):
                if spec.name in doc.layers:
                    continue
                lt = spec.linetype if spec.linetype.lower() != "dashed" else "DASHED"
                if lt == "DASHED" and "DASHED" not in doc.linetypes:
                    doc.linetypes.add("DASHED", pattern=[0.75, 0.5, -0.25])
                if lt.lower() not in {l.dxf.name.lower() for l in doc.linetypes}:
                    lt = "Continuous"  # 'Track' exists only in the official template
                doc.layers.add(spec.name, color=spec.color, linetype=lt, lineweight=spec.lineweight_dxf)
    for name, block in manifest.blocks.items():
        b = doc.blocks.new(name)
        b.add_circle((0, 0), 0.25)
        for i, a in enumerate(block.attributes):
            b.add_attdef(a.tag, (0, -0.5 * (i + 1)), dxfattribs={"height": 0.3})
    tb = doc.blocks.new(TITLE_BLOCK)
    for i, f in enumerate(manifest.title_block["fields"]):
        tb.add_attdef(f["tag"], (0, -0.5 * (i + 1)), dxfattribs={"height": 0.3})
    return doc


def detail(doc: Drawing, block: str, layer: str, at: tuple[float, float], values: dict[str, str]):
    ref = doc.modelspace().add_blockref(block, at, dxfattribs={"layer": layer})
    ref.add_auto_attribs(values)
    return ref


def square(x: float, y: float, size: float) -> list[tuple[float, float]]:
    return [(x, y), (x + size, y), (x + size, y + size), (x, y + size)]


def poly(doc: Drawing, pts, layer: str, closed: bool = True, **attrs):
    return doc.modelspace().add_lwpolyline(pts, close=closed, dxfattribs={"layer": layer, **attrs})


def title(doc: Drawing, at=(E0 - 50, N0 - 50), consultant="SYNTHETIC CONSULTANT LLC", contractor="M4 Contracting"):
    poly(doc, square(at[0], at[1], 20), "Title")
    return detail(doc, TITLE_BLOCK, "Title", (at[0] + 1, at[1] + 19),
                  {"MainConsultantName": consultant, "MainContractorName": contractor})


PLOT_VALUES = {"PlotNumber": "P-001", "SectorNumber": "S12", "UsageCategoryType": "residential",
               "UsageType": "villa"}


def valid_plot(manifest: Manifest) -> Drawing:
    doc = new_doc(manifest, ("plot",))
    title(doc)
    poly(doc, square(E0, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), PLOT_VALUES)
    poly(doc, square(E0 + 30, N0, 30), "Plot")  # shares an edge with vertices snapped
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 45, N0 + 15), {**PLOT_VALUES, "PlotNumber": "P-002"})
    poly(doc, [(E0 - 5, N0 - 5), (E0 + 65, N0 - 5), (E0 + 65, N0 + 35), (E0 - 5, N0 + 35)], "Sector")
    detail(doc, "SectorDetail", "SectorDetail", (E0 + 30, N0 + 33),
           {"SectorNumber": "S12", "SectorNameEnglish": "Sector Twelve", "SectorNameArabic": "القطاع"})
    return doc


def open_polygon(manifest: Manifest) -> Drawing:
    doc = valid_plot(manifest)
    poly(doc, [(E0, N0 + 40), (E0 + 30, N0 + 40), (E0 + 30, N0 + 70), (E0, N0 + 70)], "Plot", closed=False)
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 55), {**PLOT_VALUES, "PlotNumber": "P-003"})
    return doc


def self_intersecting(manifest: Manifest) -> Drawing:
    doc = new_doc(manifest, ("plot",))
    title(doc)
    poly(doc, [(E0, N0), (E0 + 30, N0 + 30), (E0 + 30, N0), (E0, N0 + 30)], "Plot")  # bow-tie
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 25, N0 + 15), PLOT_VALUES)
    return doc


def zero_length(manifest: Manifest) -> Drawing:
    doc = new_doc(manifest, ("roads",))
    title(doc)
    poly(doc, [(E0, N0), (E0, N0)], "RoadEdge", closed=False)
    return doc


def duplicate_geometry(manifest: Manifest) -> Drawing:
    doc = valid_plot(manifest)
    poly(doc, square(E0, N0, 30), "Plot")
    return doc


def attribute_outside(manifest: Manifest) -> Drawing:
    doc = new_doc(manifest, ("plot",))
    title(doc)
    poly(doc, square(E0, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), PLOT_VALUES)         # inside
    poly(doc, square(E0 + 30, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 100, N0 + 100), {**PLOT_VALUES, "PlotNumber": "P-002"})  # outside
    return doc


def ambiguous_line(manifest: Manifest) -> Drawing:
    doc = new_doc(manifest, ("roads",))
    title(doc)
    doc.layers.add("C-ROAD-EDGE")
    doc.layers.add("KERB")
    poly(doc, [(E0, N0), (E0 + 100, N0)], "C-ROAD-EDGE", closed=False)
    poly(doc, [(E0, N0 + 20), (E0 + 100, N0 + 20)], "KERB", closed=False)
    poly(doc, [(E0, N0 + 10), (E0 + 100, N0 + 10)], "0", closed=False)
    return doc


def unsupported_3d(manifest: Manifest) -> Drawing:
    doc = new_doc(manifest, ("plot",))
    title(doc)
    doc.modelspace().add_polyline3d([(E0, N0, 0), (E0 + 30, N0, 5), (E0 + 30, N0 + 30, 0)], close=True,
                                    dxfattribs={"layer": "Plot"})
    p = poly(doc, square(E0 + 40, N0, 30), "Plot", elevation=12.5)
    p.dxf.const_width = 0.5
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 55, N0 + 15), PLOT_VALUES)
    doc.modelspace().add_3dface([(E0, N0 + 40, 0), (E0 + 5, N0 + 40, 1), (E0 + 5, N0 + 45, 2)],
                                dxfattribs={"layer": "Plot"})
    return doc


def unknown_crs(manifest: Manifest) -> Drawing:
    """Valid structure but local (arbitrary) coordinates near the origin."""
    doc = new_doc(manifest, ("plot",))
    title(doc, at=(-50, -50))
    poly(doc, square(0, 0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (15, 15), PLOT_VALUES)
    return doc


def prohibited_entities(manifest: Manifest) -> Drawing:
    doc = new_doc(manifest, ("plot", "roads"))
    title(doc)
    msp = doc.modelspace()
    msp.add_line((E0, N0), (E0 + 10, N0), dxfattribs={"layer": "RoadEdge"})
    msp.add_arc((E0, N0), 5, 0, 90, dxfattribs={"layer": "RoadEdge"})
    msp.add_spline([(E0, N0), (E0 + 5, N0 + 5), (E0 + 10, N0)], dxfattribs={"layer": "RoadCenterLine"})
    msp.add_ellipse((E0, N0), (5, 0, 0), 0.5, dxfattribs={"layer": "Plot"})
    msp.add_xline((E0, N0), (1, 1, 0), dxfattribs={"layer": "Plot"})
    msp.add_solid([(E0, N0), (E0 + 1, N0), (E0, N0 + 1)], dxfattribs={"layer": "Plot"})
    hatch = msp.add_hatch(dxfattribs={"layer": "Plot"})
    hatch.paths.add_polyline_path(square(E0, N0, 5), is_closed=True)
    msp.add_text("PLOT 12", dxfattribs={"layer": "Plot", "insert": (E0, N0)})
    msp.add_circle((E0 + 50, N0 + 50), 3, dxfattribs={"layer": "Plot"})
    g = doc.groups.new("SYNTH_GROUP")
    g.extend([e for e in msp if e.dxftype() == "LINE"])
    return doc


def fixable(manifest: Manifest) -> Drawing:
    """Entities with lossless or tolerance-bounded fixes available."""
    doc = new_doc(manifest, ("plot",))
    title(doc)
    # Ends on its start vertex but Closed flag not set.
    poly(doc, square(E0, N0, 30) + [(E0, N0)], "Plot", closed=False)
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), PLOT_VALUES)
    # Heavy 2D POLYLINE.
    doc.modelspace().add_polyline2d(square(E0 + 40, N0, 30), close=True, dxfattribs={"layer": "Plot"})
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 55, N0 + 15), {**PLOT_VALUES, "PlotNumber": "P-002"})
    # LWPOLYLINE with an arc segment and a colour override.
    doc.modelspace().add_lwpolyline([(E0 + 80, N0, 0), (E0 + 110, N0, 0.4), (E0 + 110, N0 + 30, 0),
                                     (E0 + 80, N0 + 30, 0)], format="xyb", close=True,
                                    dxfattribs={"layer": "Plot", "color": 1})
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 95, N0 + 15), {**PLOT_VALUES, "PlotNumber": "P-003"})
    return doc


def mixed(manifest: Manifest) -> Drawing:
    """Plot + Roads + Services in one drawing, valid and invalid entities mixed."""
    doc = new_doc(manifest)
    title(doc)
    msp = doc.modelspace()
    # plots
    poly(doc, square(E0, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 15, N0 + 15), PLOT_VALUES)
    poly(doc, square(E0 + 30, N0, 30), "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (E0 + 45, N0 + 15),
           {**PLOT_VALUES, "PlotNumber": "P-002", "UsageCategoryType": "Residential", "UsageType": "shop"})
    # roads: two edges and a centre line with details snapped to vertices
    poly(doc, [(E0, N0 - 5), (E0 + 30, N0 - 5), (E0 + 60, N0 - 5)], "RoadEdge", closed=False)
    detail(doc, "RoadEdgeDetail", "RoadEdgeDetail", (E0 + 30, N0 - 5),
           {"Medium": "surface", "RoadSurfaceType": "tarmac"})
    poly(doc, [(E0, N0 - 25), (E0 + 30, N0 - 25), (E0 + 59.98, N0 - 25)], "RoadEdge", closed=False)
    detail(doc, "RoadEdgeDetail", "RoadEdgeDetail", (E0 + 15, N0 - 25),  # on the line, not on a vertex
           {"Medium": "Surface", "RoadSurfaceType": "tarmac"})
    poly(doc, [(E0, N0 - 15), (E0 + 30, N0 - 15), (E0 + 60, N0 - 15)], "RoadCenterLine", closed=False)
    detail(doc, "RoadCentreLineDetail", "RoadCenterLineDetail", (E0 + 30, N0 - 15),
           {"Medium": "surface", "RoadSurfaceType": "tarmac", "RoadType": "street", "RoadNameEnglish": "Al Falah St",
            "RoadNameArabic": "", "StreetID": "12"})
    msp.add_line((E0, N0 - 30), (E0 + 60, N0 - 30), dxfattribs={"layer": "RoadEdge"})
    # services: corridor overlapping a plot, a strip inside, a work area with a bad date
    poly(doc, [(E0 + 25, N0 - 4), (E0 + 70, N0 - 4), (E0 + 70, N0 + 5), (E0 + 25, N0 + 5)], "ServiceCorridor")
    detail(doc, "ServiceCorridorDetail", "ServiceCorridorDetail", (E0 + 65, N0),
           {"CorridorType": "roadServiceReservation", "CorridorWidth": "9.0"})
    poly(doc, [(E0 + 61, N0 - 3), (E0 + 69, N0 - 3), (E0 + 69, N0 - 1), (E0 + 61, N0 - 1)], "ReservedStrip")
    detail(doc, "ReservedStripDetail", "ReservedStripDetail", (E0 + 65, N0 - 2),
           {"ReservedStripType": "WD", "ReservedStripWidth": "2"})
    poly(doc, square(E0 + 100, N0, 20), "ServiceWorkArea")
    detail(doc, "ServiceWorkAreaDetail", "ServiceWorkAreaDetail", (E0 + 110, N0 + 10),
           {"ExpectedStartDate": "2024-01-05", "ExpectedEndDate": "05-DEC-2025", "WorkAreaFor": "Telecom"})
    # unknown layer content
    doc.layers.add("SURVEY-POINTS")
    msp.add_point((E0 + 5, N0 + 5), dxfattribs={"layer": "SURVEY-POINTS"})
    poly(doc, [(E0, N0 + 40), (E0 + 60, N0 + 40)], "C-ANNOT", closed=False)
    return doc


ALL = {
    "valid_plot": valid_plot,
    "open_polygon": open_polygon,
    "self_intersecting": self_intersecting,
    "zero_length": zero_length,
    "duplicate_geometry": duplicate_geometry,
    "attribute_outside": attribute_outside,
    "ambiguous_line": ambiguous_line,
    "unsupported_3d": unsupported_3d,
    "unknown_crs": unknown_crs,
    "prohibited_entities": prohibited_entities,
    "fixable": fixable,
    "mixed": mixed,
}


def finish(doc: Drawing) -> Drawing:
    """Drop block definitions the fixture does not use, so 'valid' fixtures are clean."""
    from m4adm.classify import unused_block_names
    for name in unused_block_names(doc):
        doc.blocks.delete_block(name, safe=False)
    return doc


def write_all(out_dir: Path, manifest: Manifest | None = None) -> list[Path]:
    manifest = manifest or load_manifest()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, fn in ALL.items():
        path = out_dir / f"SYNTHETIC_{name}.dxf"
        finish(fn(manifest)).saveas(str(path))
        paths.append(path)
    (out_dir / "README.md").write_text(
        f"# Synthetic fixtures\n\n**{SYNTHETIC_LABEL}.**\n\n"
        "Generated by `m4adm fixtures <dir>` (source: `src/m4adm/fixtures.py`). Block definitions are built "
        "from the PDF attribute tables only so the checks have input; they are not the official ADM template "
        "blocks and must never be used in a submission. Each drawing carries the custom header property "
        "`SYNTHETIC`.\n\n| File | Purpose |\n|---|---|\n"
        + "\n".join(f"| `SYNTHETIC_{n}.dxf` | {(fn.__doc__ or n.replace('_', ' ')).strip().splitlines()[0]} |"
                    for n, fn in ALL.items()) + "\n",
        encoding="utf-8",
    )
    return paths


# --------------------------------------------------------------------------- DRM BDMS 4.1 (building floor)
BDMS_META = {"zone_name": "SYNTH ZONE", "sector_number": "SE01_01", "plot_number": "C1", "building_number": "1",
             "floor_id": "F1", "contractor_name": "M4 Contracting"}


def bdms_floor(manifest: Manifest, *, door_vertices_on_spaces: bool = True, extra_layers: tuple[str, ...] = ()
               ) -> Drawing:
    """A clean synthetic building floor (SYNTHETIC, NOT AN OFFICIAL SAMPLE) in UTM 40N metres.

    Plot 40x30 contains a 20x10 building; Floor = Unit = BuildingRoof = outline; two spaces split the floor
    at y=5 with a door straddling the shared wall (vertices added where the door crosses it).
    """
    doc = ezdxf.new("R2010")
    doc.header.custom_vars.append("SYNTHETIC", SYNTHETIC_LABEL)
    for spec in manifest.layers_for("building"):
        doc.layers.add(spec.name, color=spec.color, lineweight=25)
    for name in extra_layers:
        doc.layers.add(name)
    for name, block in manifest.blocks.items():
        b = doc.blocks.new(name)
        for i, a in enumerate(block.attributes):
            b.add_attdef(a.tag.upper(), (0, -0.3 * (i + 1)), dxfattribs={"height": 0.2})
    x0, y0 = E0, N0
    poly(doc, [(x0 - 10, y0 - 10), (x0 + 30, y0 - 10), (x0 + 30, y0 + 20), (x0 - 10, y0 + 20)], "Plot")
    detail(doc, "PlotDetail", "PlotDetail", (x0 - 8, y0 - 8),
           {"PLOTNUMBER": "C1", "SECTORNUMBER": "SE01_01", "ZONENAME": "SYNTH ZONE"})
    outline_v = [(x0, y0), (x0 + 20, y0), (x0 + 20, y0 + 5), (x0 + 20, y0 + 10), (x0, y0 + 10), (x0, y0 + 5)]
    poly(doc, outline_v, "BuildingOutline")
    detail(doc, "BuildingDetail", "BuildingDetail", (x0 + 1, y0 + 1),
           {"BUILDINGNUMBER": "1", "BUILDINGNUMOFFLOORS": "2", "USAGECATEGORYTYPE": "Residential",
            "USAGETYPE": "Household Living", "PLOTNUMBER": "C1", "SECTORNUMBER": "SE01_01"})
    poly(doc, outline_v, "BuildingRoof")
    detail(doc, "BuildingRoofDetail", "BuildingRoofDetail", (x0 + 1.5, y0 + 1.5),
           {"BUILDINGNUMBER": "1", "BUILDINGHEIGHT": "7.2"})
    poly(doc, outline_v, "Floor")
    detail(doc, "FloorDetail", "FloorDetail", (x0 + 2, y0 + 2),
           {"FLOORNUMBER": "F1", "BUILDINGNUMBER": "1", "FLOORHEIGHT": "3.6"})
    poly(doc, outline_v, "Unit")
    detail(doc, "UnitDetail", "UnitDetail", (x0 + 2.5, y0 + 2.5),
           {"UNITNUMBER": "1", "FLOORNUMBER": "F1", "UNITTYPE": "Residential", "UNITCLASSIFICATION": "Apartment",
            "UNITAREA": "200", "UNITNUMBEDROOM": "2", "UNITNUMBATHROOM": "2", "UNITUSAGETYPE": "Household Living",
            "UNITOWNERNAME": "Owner Name", "UNITOWNERNATIOANLITY": "UAE", "UNITOWNERPASSPORT": "P1234567"})
    wall = [(x0 + 10, y0 + 5), (x0 + 9, y0 + 5)] if door_vertices_on_spaces else []
    poly(doc, [(x0, y0), (x0 + 20, y0), (x0 + 20, y0 + 5), *wall, (x0, y0 + 5)], "Space")
    detail(doc, "SpaceDetail", "SpaceDetail", (x0 + 5, y0 + 2),
           {"SPACENUMBER": "1", "UNITNUMBER": "1", "FLOORNUMBER": "F1", "SPACEUSAGE": "LIVING"})
    poly(doc, [(x0, y0 + 5), *reversed(wall), (x0 + 20, y0 + 5), (x0 + 20, y0 + 10), (x0, y0 + 10)], "Space")
    detail(doc, "SpaceDetail", "SpaceDetail", (x0 + 5, y0 + 8),
           {"SPACENUMBER": "2", "UNITNUMBER": "1", "FLOORNUMBER": "F1", "SPACEUSAGE": "BEDROOM"})
    poly(doc, [(x0 + 9, y0 + 4.9), (x0 + 10, y0 + 4.9), (x0 + 10, y0 + 5), (x0 + 10, y0 + 5.1), (x0 + 9, y0 + 5.1),
               (x0 + 9, y0 + 5)], "Door")
    detail(doc, "DoorDetail", "DoorDetail", (x0 + 9.5, y0 + 5.02),
           {"SPACENUMBER": "2", "UNITNUMBER": "1", "FLOORNUMBER": "F1", "TYPE": "wood"})
    poly(doc, [(x0 - 10, y0 + 25), (x0 + 30, y0 + 25), (x0 + 30, y0 + 35), (x0 - 10, y0 + 35)], "Title")
    detail(doc, "ProjectDetail", "Title", (x0 - 9, y0 + 34),
           {"DEVELOPERNAME": "SYNTHETIC DEVELOPER", "PROPERTYNAME": "", "UNIQUEBUILDINGNUMBER": "1",
            "BUILDINGNAME": ""})
    detail(doc, "DrawingDetail", "Title", (x0 + 10, y0 + 34),
           {"DRAWINGTITLE": "SYNTH ZONE-SE01_01-C1-1-F1", "DRAWINGTYPE": "As Built", "DATEOFDRAWING": "14-Jan-2026",
            "DRAWINGSCALE": "100"})
    return doc
