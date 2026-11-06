"""Stages E + F: source-to-target mapping and attribute population (DRM BDMS 4.1 building floor).

Every target attribute records where its value came from:

    SOURCE   read directly from the source drawing (e.g. room name text)
    DERIVED  computed by a documented deterministic rule (e.g. Unit area from the polygon)
    PROPOSED derived by a rule whose result an engineer must confirm (e.g. space number from "01-04")
    USER     entered by the engineer (job settings / feature decisions)
    MISSING  not available; never guessed

No mandatory identifier, unit number, classification or project fact is invented: if the drawing or the engineer
does not provide it, it stays MISSING and the report lists it.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from shapely.geometry import Polygon
from shapely.ops import unary_union

from m4adm.convert.rooms import HIGH, NOT_GENERATED, REVIEW, UNRESOLVED, Detection
from m4adm.convert.settings import ConversionSettings
from m4adm.convert.source import SourceModel, match
from m4adm.rules import Manifest

SOURCE, DERIVED, PROPOSED, USER, MISSING = "SOURCE", "DERIVED", "PROPOSED", "USER", "MISSING"
ACCEPTED, REJECTED = "USER_ACCEPTED", "USER_REJECTED"
EXPORTED_STATUSES = {HIGH, REVIEW, ACCEPTED}


@dataclass
class AttrValue:
    value: str
    provenance: str
    note: str = ""

    def as_dict(self) -> dict:
        return {"value": self.value, "provenance": self.provenance, "note": self.note}


@dataclass
class Feature:
    id: str
    layer: str                     # target geometry layer
    status: str
    reasons: list[str]
    poly: Polygon | None = None
    source_handles: list[str] = field(default_factory=list)
    attributes: dict[str, AttrValue] = field(default_factory=dict)
    block: str | None = None       # Detail block name
    room: str | None = None        # region id, for spaces
    link: str | None = None        # region id of the space a door/window belongs to
    source_number: str | None = None   # room number printed in the source (e.g. "01-04"), for spaces

    @property
    def exported(self) -> bool:
        return self.status in EXPORTED_STATUSES and self.poly is not None

    def as_dict(self) -> dict:
        return {
            "id": self.id, "layer": self.layer, "status": self.status, "reasons": self.reasons,
            "area_m2": round(self.poly.area, 3) if self.poly is not None else None,
            "vertices": [[round(x, 4), round(y, 4)] for x, y in self.poly.exterior.coords[:-1]]
            if self.poly is not None else None,
            "source_handles": sorted(set(self.source_handles)),
            "detail_block": self.block,
            "attributes": {k: v.as_dict() for k, v in self.attributes.items()},
        }


def _blank(manifest: Manifest, block: str) -> dict[str, AttrValue]:
    return {a.tag.upper(): AttrValue("", MISSING) for a in manifest.blocks[block].attributes}


def _user(attrs: dict[str, AttrValue], tag: str, value: str, note: str = "job settings") -> None:
    if value:
        attrs[tag] = AttrValue(str(value), USER, note)


def _source_order(number: str | None) -> tuple:
    """Sort key: spaces with a source room number first, in that number's order ('01-02' < '01-10')."""
    if not number:
        return (1, ())
    return (0, tuple(int(x) for x in re.findall(r"\d+", number)))


def number_spaces(feats: list[Feature]) -> list[str]:
    """Give every exported space a SpaceNumber 1, 2, 3 ... with no gaps or blanks (official QC key note 8), then
    point each door/window at its room's number. Numbers an engineer entered (USER) are kept and skipped.

    Order: rooms with a source room number by that number, then the others by decreasing area. Returns notes for
    the report (e.g. links to rooms that are not exported)."""
    spaces = [f for f in feats if f.layer == "Space" and f.exported]
    taken = {f.attributes["SPACENUMBER"].value for f in spaces
             if f.attributes.get("SPACENUMBER") and f.attributes["SPACENUMBER"].provenance == USER}
    counter = 0
    for f in sorted(spaces, key=lambda f: (_source_order(f.source_number), -f.poly.area, f.id)):
        if f.attributes["SPACENUMBER"].provenance == USER:
            continue
        counter += 1
        while str(counter) in taken:
            counter += 1
        note = "progressive numbering 1, 2, 3 ... (official QC key note 8)"
        if f.source_number:
            note += f"; source room number {f.source_number}"
        f.attributes["SPACENUMBER"] = AttrValue(str(counter), DERIVED, note)
    by_room = {f.room: f for f in spaces}
    notes = []
    for f in feats:
        if f.layer not in ("Door", "Window") or not f.exported or f.attributes.get("SPACENUMBER", AttrValue("", "")) \
                .provenance == USER:
            continue
        room = by_room.get(f.link)
        if room is None:
            f.attributes["SPACENUMBER"] = AttrValue("", MISSING, "the space this opening belongs to was not "
                                                    "generated or was rejected")
            notes.append(f"{f.id}: no exported space to link to")
            continue
        f.attributes["SPACENUMBER"] = AttrValue(room.attributes["SPACENUMBER"].value, PROPOSED,
                                                f"{'the smaller room the opening serves' if f.layer == 'Door' else 'nearest room'}"
                                                f" ({room.id}) - confirm")
    return notes


def build_features(model: SourceModel, det: Detection, manifest: Manifest, settings: ConversionSettings
                   ) -> list[Feature]:
    md = settings.metadata
    feats: list[Feature] = []
    unit_no = settings.single_unit_number

    def common(attrs: dict[str, AttrValue]) -> None:
        if "FLOORNUMBER" in attrs:
            _user(attrs, "FLOORNUMBER", md.floor_id, "floor id in job settings")
        if "UNITNUMBER" in attrs:
            _user(attrs, "UNITNUMBER", unit_no, "single-unit floor declared in job settings")
        if "BUILDINGNUMBER" in attrs:
            _user(attrs, "BUILDINGNUMBER", md.building_number)

    env = det.envelope
    # ---- Floor / BuildingOutline / Unit / BuildingRoof / Plot
    floor_attrs = _blank(manifest, "FloorDetail")
    common(floor_attrs)
    _user(floor_attrs, "FLOORHEIGHT", settings.floor_height)
    feats.append(Feature("FLOOR", "Floor", det.envelope_status if env is not None else UNRESOLVED,
                         [det.envelope_reason], env, [], floor_attrs, "FloorDetail"))
    b_attrs = _blank(manifest, "BuildingDetail")
    common(b_attrs)
    _user(b_attrs, "PLOTNUMBER", md.plot_number)
    _user(b_attrs, "SECTORNUMBER", md.sector_number)
    _user(b_attrs, "BUILDINGNUMOFFLOORS", settings.building_number_of_floors)
    _user(b_attrs, "USAGECATEGORYTYPE", settings.building_usage_category)
    _user(b_attrs, "USAGETYPE", settings.building_usage_type)
    feats.append(Feature("BUILDING_OUTLINE", "BuildingOutline", REVIEW if env is not None else UNRESOLVED,
                         ["this floor's outer wall boundary; the building outline must enclose the building's "
                          "footprint over all floors - confirm against the ground floor / site plan"]
                         if env is not None else [det.envelope_reason], env, [], b_attrs, "BuildingDetail"))
    if unit_no:
        u_attrs = _blank(manifest, "UnitDetail")
        common(u_attrs)
        if env is not None:
            u_attrs["UNITAREA"] = AttrValue(f"{env.area:.0f}", DERIVED, "area of the generated unit polygon, m2")
        feats.append(Feature("UNIT_1", "Unit", REVIEW if env is not None else UNRESOLVED,
                             ["single-unit floor declared by the engineer: the unit is drawn on the floor outline"],
                             env, [], u_attrs, "UnitDetail"))
    else:
        feats.append(Feature("UNIT", "Unit", NOT_GENERATED,
                             ["units cannot be derived from walls; declare a single-unit floor (unit number) or "
                              "draw units in CAD"], None, [], {}, "UnitDetail"))
    roof_attrs = _blank(manifest, "BuildingRoofDetail")
    common(roof_attrs)
    _user(roof_attrs, "BUILDINGHEIGHT", settings.building_height)
    # Every DRM-accepted floor file repeats the BuildingOutline as its BuildingRoof polygon (KHALIFA CITY G/F1/F2/F3;
    # the official QC rejects a floor without one, trial 02). Kept identical to the outline after topology.
    feats.append(Feature("BUILDING_ROOF", "BuildingRoof", REVIEW if env is not None else UNRESOLVED,
                         ["drawn on the building outline, as in the DRM-accepted drawings - confirm against the roof "
                          "plan"] if env is not None else [det.envelope_reason], env, [], roof_attrs,
                         "BuildingRoofDetail"))
    feats.append(Feature("PLOT", "Plot", NOT_GENERATED,
                         ["the plot boundary comes from the affection / site plan, not from a floor plan"], None, [],
                         {}, "PlotDetail"))

    # ---- Spaces
    rooms = [r for r in det.regions if r.status != NOT_GENERATED]
    for r in det.regions:
        attrs = _blank(manifest, "SpaceDetail")
        common(attrs)
        if r.status != NOT_GENERATED:
            if len(r.names) == 1:
                attrs["SPACEUSAGE"] = AttrValue(r.names[0], SOURCE, "room name text inside the region")
            elif r.names:
                attrs["SPACEUSAGE"] = AttrValue("", MISSING, "several names: " + ", ".join(r.names))
        feats.append(Feature(f"SPACE_{r.id}", "Space", r.status, list(r.reasons), r.poly, list(r.label_handles),
                             attrs, "SpaceDetail", room=r.id,
                             source_number=r.numbers[0] if len(r.numbers) == 1 else None))
    for lab in det.unplaced_labels:
        feats.append(Feature(f"LABEL_{lab.handles[0]}", "Space", UNRESOLVED,
                             [f"room label '{lab.name}' is not inside any enclosed region inside the floor outline "
                              "(outside the building, or its room is not closed by walls)"], None, list(lab.handles)))

    # ---- Doors: each group of parallel doorway closures across one wall becomes one door rectangle, extended
    # across the wall to the room face on each side (at most 0.6 m).
    n_door = 0
    for group in _closure_groups(det.closures):
        quad, sides = _door_rect(group, rooms)
        if quad is None:
            continue
        n_door += 1
        attrs = _blank(manifest, "DoorDetail")
        common(attrs)
        adj = [r for r in rooms if r.poly.distance(quad) < 0.05]
        link = min(adj, key=lambda r: r.poly.area).id if adj else None
        door_blocks = [ins for ins in model.inserts if match(ins.layer, settings.roles["door"])
                       and any(g.distance(quad) < 0.3 for g in ins.geom)]
        width = max(c.width for c in group) + settings.tolerances.gap_close   # closures run between buffered walls
        reasons = [f"opening {width:.2f} m wide between aligned wall ends ({len(group)} closure line(s)); "
                   "door or open passage - confirm"]
        if door_blocks:
            reasons.append("door block(s) at the opening: " + ", ".join(sorted({d.block for d in door_blocks}))[:200])
        feats.append(Feature(f"DOOR_{n_door:03d}", "Door", REVIEW, reasons, quad,
                             [d.source_handle for d in door_blocks], attrs, "DoorDetail", link=link))

    # ---- Windows: window-role block references inside the floor outline.
    n_win = 0
    for ins in model.inserts:
        if not match(ins.layer, settings.roles["window"]):
            continue
        shape = unary_union([g if isinstance(g, Polygon) else g.buffer(0.001) for g in ins.geom])
        rect = shape.minimum_rotated_rectangle
        if not isinstance(rect, Polygon) or rect.area <= 0:
            continue
        if env is not None and not rect.intersects(env.buffer(0.5)):
            continue
        n_win += 1
        attrs = _blank(manifest, "WindowDetail")
        common(attrs)
        adj = [r for r in rooms if r.poly.distance(rect) < 0.6]
        link = min(adj, key=lambda r: r.poly.distance(rect)).id if adj else None
        if "GLASS" in (ins.block or "").upper() or "GLAZ" in (ins.block or "").upper():
            attrs["TYPE"] = AttrValue("glass", DERIVED, f"source block name '{ins.block[:60]}'")
        feats.append(Feature(f"WINDOW_{n_win:03d}", "Window", HIGH,
                             [f"window block on layer {ins.layer} ({ins.block[:60]}); outline = its bounding rectangle"],
                             rect, [ins.source_handle], attrs, "WindowDetail", link=link))
    return feats


def _unit(c) -> tuple[float, float]:
    dx, dy = c.b[0] - c.a[0], c.b[1] - c.a[1]
    n = math.hypot(dx, dy)
    return dx / n, dy / n


def _closure_groups(closures, max_gap: float = 0.6, tol_deg: float = 5.0) -> list[list]:
    """Union parallel closures that overlap along their length and lie within one wall thickness."""
    parent = list(range(len(closures)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cos_tol = math.cos(math.radians(tol_deg))
    for i, a in enumerate(closures):
        ua = _unit(a)
        for j in range(i + 1, len(closures)):
            b = closures[j]
            ub = _unit(b)
            if abs(ua[0] * ub[0] + ua[1] * ub[1]) < cos_tol or a.line.distance(b.line) > max_gap:
                continue
            sa = sorted(((p[0] - a.a[0]) * ua[0] + (p[1] - a.a[1]) * ua[1]) for p in (a.a, a.b))
            sb = sorted(((p[0] - a.a[0]) * ua[0] + (p[1] - a.a[1]) * ua[1]) for p in (b.a, b.b))
            overlap = min(sa[1], sb[1]) - max(sa[0], sb[0])
            if overlap >= 0.5 * min(a.width, b.width):
                parent[find(i)] = find(j)
    groups: dict[int, list] = {}
    for i, c in enumerate(closures):
        groups.setdefault(find(i), []).append(c)
    return list(groups.values())


def _door_rect(group, rooms, reach: float = 0.6):
    """Rectangle over the group's closures, extended along the wall normal to the nearest room on each side."""
    from shapely.geometry import LineString, Point
    from shapely.ops import nearest_points

    o = group[0].a
    u = _unit(group[0])
    n = (-u[1], u[0])
    pts = [p for c in group for p in (c.a, c.b)]
    S = [(p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1] for p in pts]
    T = [(p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] for p in pts]
    s0, s1, t0, t1 = min(S), max(S), min(T), max(T)
    at = lambda s, t: (o[0] + s * u[0] + t * n[0], o[1] + s * u[1] + t * n[1])  # noqa: E731
    sides = {"+": None, "-": None}
    for side, t_line, sign in (("+", t1, 1), ("-", t0, -1)):
        line = LineString([at(s0, t_line), at(s1, t_line)])
        best = None
        for r in rooms:
            d = r.poly.distance(line)
            if d > reach:
                continue
            q = nearest_points(line, r.poly)[1]
            tq = (q.x - o[0]) * n[0] + (q.y - o[1]) * n[1]
            probe = Point(at((s0 + s1) / 2, tq + sign * 0.05))
            if (tq - t_line) * sign < -1e-6 or not r.poly.buffer(1e-6).contains(probe):
                continue
            if best is None or d < best:
                best = d
        sides[side] = best
    if sides["+"] is not None:
        t1 += sides["+"]
    if sides["-"] is not None:
        t0 -= sides["-"]
    if t1 - t0 < 0.02:
        t0, t1 = t0 - 0.05, t1 + 0.05
    quad = Polygon([at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)])
    return (quad if quad.is_valid and quad.area > 0 else None), sides


def apply_decisions(feats: list[Feature], settings: ConversionSettings) -> list[str]:
    """Apply engineer decisions; returns ids that matched nothing (reported, never silently ignored)."""
    by_id = {f.id: f for f in feats}
    unknown = []
    for fid, dec in settings.feature_decisions.items():
        f = by_id.get(fid)
        if f is None:
            unknown.append(fid)
            continue
        if dec.action == "reject":
            f.status = REJECTED
            f.reasons.append("rejected by the engineer")
        else:
            if f.poly is None:
                f.reasons.append("accept ignored: nothing was generated for this item")
            else:
                f.status = ACCEPTED
                f.reasons.append("accepted by the engineer")
        for tag, value in dec.attributes.items():
            f.attributes[tag.upper()] = AttrValue(value, USER, "entered by the engineer")
    return unknown


def missing_mandatory(feats: list[Feature], manifest: Manifest) -> list[dict]:
    out = []
    for f in feats:
        if not f.exported or not f.block:
            continue
        for a in manifest.blocks[f.block].attributes:
            v = f.attributes.get(a.tag.upper())
            if a.mandatory and (v is None or not v.value):
                out.append({"feature": f.id, "block": f.block, "tag": a.tag.upper(),
                            "note": v.note if v else ""})
    return out


def title_values(manifest: Manifest, settings: ConversionSettings, stem: str | None) -> dict[str, dict[str, AttrValue]]:
    md = settings.metadata
    proj = _blank(manifest, "ProjectDetail")
    _user(proj, "UNIQUEBUILDINGNUMBER", md.building_number)
    drw = _blank(manifest, "DrawingDetail")
    if stem:
        drw["DRAWINGTITLE"] = AttrValue(stem, DERIVED, "BDMS file name from zone, sector, plot, building and floor")
    for tag, value in settings.title_values.items():
        for block in (proj, drw):
            if tag.upper() in block:
                _user(block, tag.upper(), value, "title value in job settings")
    return {"ProjectDetail": proj, "DrawingDetail": drw}


__all__ = ["Feature", "AttrValue", "build_features", "apply_decisions", "missing_mandatory", "title_values",
           "number_spaces",
           "SOURCE", "DERIVED", "PROPOSED", "USER", "MISSING", "ACCEPTED", "REJECTED"]
