"""Checks specific to the DRM BDMS 4.1 building profile (one building floor per file).

Each check maps to a rule in rules/drm_bdms_v4.1.yaml, which records the corresponding official QC
tool error (DRM_CPDQC_V2.3 user manual). Generic geometry and attribute checks run as well; this
module adds the file-name, title-block, hierarchy, identifier and cross-reference logic.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

from shapely.geometry import Point

from m4adm.classify import EntityRecord
from m4adm.models import Metadata, Severity, Tolerances
from m4adm.rules import LayerSpec, Manifest
from m4adm.validate import Collector
from m4adm.validate.features import FeatureContext, check_block_attributes

POS_INT = re.compile(r"^[1-9][0-9]*$")


# --------------------------------------------------------------------------- file name
def build_stem(meta: Metadata) -> str:
    return "-".join([meta.zone_name, meta.sector_number, meta.plot_number, meta.building_number, meta.floor_id])


def parse_stem(stem: str) -> dict[str, str] | None:
    parts = stem.split("-")
    if len(parts) != 5:
        return None
    return dict(zip(("zone", "sector", "plot", "building", "floor"), parts))


def validate_stem(stem: str, col: Collector, *, context: str = "") -> bool:
    fn = col.manifest.filename
    where = f" ({context})" if context else ""
    before = len(col.findings)
    parts = parse_stem(stem)
    if parts is None:
        col.add("DRM-GEN-01", f"File name '{stem}' has {len(stem.split('-'))} hyphen-separated parts; 5 are required"
                f"{where}.", "Use <ZoneName>-<SectorNumber>-<PlotNumber>-<BuildingNumber>-<FloorID>, e.g. "
                "AbuDhabi-E_1-C_1-1-F1. Only the hyphen separates parts; zone/sector/plot may contain '_'.")
        return False
    empty = [k for k, v in parts.items() if not v.strip()]
    if empty:
        col.add("DRM-GEN-01", f"File name '{stem}' has empty part(s): {', '.join(empty)}{where}.",
                "Enter zone, sector, plot, building number and floor ID (e.g. KHALIFA CITY-SE45_01-C8-1-F1).")
        return False
    for key in ("zone", "sector", "plot"):
        if parts[key] != parts[key].strip():
            col.add("DRM-GEN-01", f"{key.title()} part '{parts[key]}' has leading/trailing spaces{where}.",
                    f"Enter the DRM-approved {key} name exactly.")
    if not re.fullmatch(fn["building_id_regex"], parts["building"]):
        col.add("DRM-GEN-01", f"Building ID '{parts['building']}' is not a positive integer{where}.",
                "Number buildings 1, 2, 3 ... within the plot (spec §1.3).")
    if not re.fullmatch(fn["floor_id_regex"], parts["floor"]):
        col.add("DRM-GEN-02", f"Floor ID '{parts['floor']}' is not G, Fn, Mn or Bn{where}.",
                "Use G (ground), F1, F2 ... (floors), M1 ... (mezzanines) or B1 ... (basements).")
    return len(col.findings) == before


# --------------------------------------------------------------------------- helpers
def _details(records: list[EntityRecord], target: dict[str, str | None], layer: str) -> list[EntityRecord]:
    return [r for r in records if target.get(r.handle) == layer and r.dxftype == "INSERT" and r.attribs]


def _val(r: EntityRecord, tag: str) -> str:
    return (r.attribs_upper.get(tag.upper()) or "").strip()


def _kw(r: EntityRecord, layer: str) -> dict:
    return dict(handle=r.handle, layer=layer, entity_type="INSERT", location=r.location)


# --------------------------------------------------------------------------- all BDMS checks
def run_bdms_checks(records: list[EntityRecord], target: dict[str, str | None], manifest: Manifest,
                    meta: Metadata, ctx: FeatureContext, tol: Tolerances, col: Collector) -> None:
    specs = {l.name: l for l in manifest.layers_for("building")}
    stem = build_stem(meta)
    file_parts = parse_stem(stem) if validate_stem(stem, col, context="metadata") else None

    _title_blocks(records, target, manifest, stem, col)
    _layer_pairs(records, target, specs, ctx, col)
    _hierarchy(records, target, ctx, col)
    floor_no, building_nos = _consistency(records, target, file_parts, col)
    _ids_and_references(records, target, floor_no, col)
    _space_unit(records, target, ctx, tol, col)
    _containment(ctx, tol, col)
    _zero_insertion(records, target, specs, col)
    _code_lists(records, target, manifest, col)
    _one_floor(records, target, ctx, col)
    _blocks_in_polygons(records, target, specs, ctx, col)
    _space_number_entry(records, target, col)
    _official_qc_counting(col)


def _title_blocks(records, target, manifest: Manifest, stem: str, col: Collector) -> None:
    cfg = manifest.title_blocks
    on_title = [r for r in records if target.get(r.handle) == cfg["layer"] and r.dxftype == "INSERT"]
    for name in cfg["required"]:
        found = [r for r in on_title if (r.block_name or "").lower() == name.lower()]
        if not found:
            col.add("DRM-SPEC-TITLE", f"Title block '{name}' is missing on layer {cfg['layer']}.",
                    f"Insert the '{name}' block from the DRM template on layer Title and fill it in.")
            continue
        if len(found) > 1:
            col.add("DRM-SPEC-TITLE", f"{len(found)} '{name}' title blocks found; exactly one is required.",
                    "Keep a single block of each title type.", handles=[r.handle for r in found])
        spec = LayerSpec(name=cfg["layer"], topology="mixed", constraint="none", color=7, linetype="Continuous",
                         lineweight="default", block=name)
        for r in found:
            check_block_attributes(r, spec, col)
            if name == "DrawingDetail":
                title = _val(r, "DrawingTitle")
                if title and title != stem:
                    col.add("DRM-SPEC-TITLE", f"DrawingTitle '{title}' differs from the file name stem '{stem}'.",
                            "Use the file name as drawing title (as in the accepted samples), or confirm the title.",
                            severity=Severity.WARNING, **_kw(r, cfg["layer"]))


def _layer_pairs(records, target, specs: dict[str, LayerSpec], ctx: FeatureContext, col: Collector) -> None:
    """QC 4.1 #7/#8: a polygon layer without blocks, or a detail layer without polygons."""
    counts = Counter(target.get(r.handle) for r in records if r.dxftype == "INSERT")
    for name, spec in specs.items():
        if not spec.is_geometry or not spec.detail:
            continue
        polys = len(ctx.features.get(name, []))
        dets = counts.get(spec.detail, 0)
        if polys and not dets:
            col.add("DRM-GEN-07", f"Layer {name} has {polys} polygon(s) but no {spec.detail} attribute block.",
                    f"Insert one {spec.detail} block inside each {name} polygon.", layer=spec.detail)
        if dets and not polys:
            col.add("DRM-GEN-08", f"{dets} {spec.detail} block(s) but no {name} polygon.",
                    f"Draw the {name} polygon (closed LWPOLYLINE) or remove the blocks.", layer=name)


REQUIRED = [("Plot", "PlotDetail"), ("BuildingOutline", "BuildingDetail"), ("BuildingRoof", "BuildingRoofDetail"),
            ("Floor", "FloorDetail"), ("Space", "SpaceDetail")]


def _hierarchy(records, target, ctx: FeatureContext, col: Collector) -> None:
    """QC 4.4 #3, #16-17, #19-20, #23, #26-27: the required polygons of a building floor exist."""
    for layer, detail in REQUIRED:
        if not ctx.features.get(layer):
            # The official QC did not report the missing BuildingRoof in trial 01 (DISCREPANCIES_BDMS B-19).
            extra = {"severity": Severity.WARNING} if layer == "BuildingRoof" else {}
            if layer == "Plot":
                extra.update(official_qc_error="No Plot or PlotDetail found", qc_layer="")
            col.add("DRM-LOG-03", f"No {layer} polygon in the drawing.",
                    f"Draw the {layer} polygon and insert its {detail} block (required for every floor file).",
                    layer=layer, **extra)
    if ctx.features.get("Unit") and not ctx.features.get("Space"):
        col.add("DRM-LOG-03", "Unit polygons exist without any Space polygon.", "Draw the spaces of each unit.",
                layer="Space")


def _first(records, target, layer) -> EntityRecord | None:
    d = _details(records, target, layer)
    return d[0] if d else None


def _consistency(records, target, file_parts: dict | None, col: Collector) -> tuple[str | None, set[str]]:
    plot = _first(records, target, "PlotDetail")
    bld = _first(records, target, "BuildingDetail")
    floor = _first(records, target, "FloorDetail")
    roof = _first(records, target, "BuildingRoofDetail")
    project = next((r for r in records if target.get(r.handle) == "Title" and (r.block_name or "").lower()
                    == "projectdetail"), None)
    if file_parts and plot:
        if _val(plot, "ZoneName") != file_parts["zone"]:
            col.add("DRM-ATT-06", f"PlotDetail ZoneName '{_val(plot, 'ZoneName')}' differs from the file name zone "
                    f"'{file_parts['zone']}'.", "Use the same DRM zone name in the file name and PlotDetail.",
                    **_kw(plot, "PlotDetail"))
        if _val(plot, "SectorNumber") != file_parts["sector"]:
            col.add("DRM-ATT-06", f"PlotDetail SectorNumber '{_val(plot, 'SectorNumber')}' differs from the file "
                    f"name sector '{file_parts['sector']}'.", "Use the same sector in the file name and PlotDetail.",
                    **_kw(plot, "PlotDetail"))
        if _val(plot, "PlotNumber") != file_parts["plot"]:
            col.add("DRM-ATT-06", f"PlotDetail PlotNumber '{_val(plot, 'PlotNumber')}' differs from the file name "
                    f"plot '{file_parts['plot']}'.", "Use the same plot number in the file name and PlotDetail.",
                    **_kw(plot, "PlotDetail"))
    if plot and bld:
        for tag in ("PlotNumber", "SectorNumber"):
            if _val(plot, tag) != _val(bld, tag):
                col.add("DRM-LOG-04", f"{tag} differs: PlotDetail '{_val(plot, tag)}' vs BuildingDetail "
                        f"'{_val(bld, tag)}'.", f"Enter the same {tag} in both blocks.", **_kw(bld, "BuildingDetail"))
    numbers = {}
    if file_parts:
        numbers["file name"] = file_parts["building"]
    for label, rec, tag in (("ProjectDetail", project, "UniqueBuildingNumber"), ("BuildingDetail", bld, "BuildingNumber"),
                            ("FloorDetail", floor, "BuildingNumber"), ("BuildingRoofDetail", roof, "BuildingNumber")):
        if rec is not None and _val(rec, tag):
            numbers[label] = _val(rec, tag)
    if len(set(numbers.values())) > 1:
        col.add("DRM-ATT-19", "BuildingNumber is inconsistent: " + ", ".join(f"{k}={v}" for k, v in numbers.items())
                + ".", "Use one building number everywhere (file name, ProjectDetail, BuildingDetail, FloorDetail, "
                "BuildingRoofDetail).", layer="BuildingDetail")
    floor_no = _val(floor, "FloorNumber") if floor else None
    if file_parts and floor and floor_no != file_parts["floor"]:
        col.add("DRM-ATT-31", f"FloorDetail FloorNumber '{floor_no}' differs from the file name floor "
                f"'{file_parts['floor']}'.", "Use the file's floor ID in FloorDetail.", **_kw(floor, "FloorDetail"))
    if floor_no and not re.fullmatch(col.manifest.filename["floor_id_regex"], floor_no):
        col.add("DRM-SPEC-IDS", f"FloorNumber '{floor_no}' is not G, Fn, Mn or Bn.", "Use a Table 2 floor ID.",
                **_kw(floor, "FloorDetail"))
    return floor_no, set(numbers.values())


def _ids_and_references(records, target, floor_no: str | None, col: Collector) -> None:
    units = _details(records, target, "UnitDetail")
    spaces = _details(records, target, "SpaceDetail")
    unit_nos = Counter(_val(u, "UnitNumber") for u in units if _val(u, "UnitNumber"))
    space_nos = Counter(_val(s, "SpaceNumber") for s in spaces if _val(s, "SpaceNumber"))
    # Door/Window -> Space link key. Blank parts never match: in ADM QC trial 01 every window referenced an
    # existing SpaceNumber (11) with UnitNumber/FloorNumber empty on both sides and all 34 were rejected.
    space_keys = {(_val(s, "SpaceNumber"), _val(s, "UnitNumber"), _val(s, "FloorNumber")) for s in spaces}
    if spaces:
        nums = sorted(int(v) for v in space_nos if POS_INT.match(v))
        gaps = sorted(set(range(1, (nums[-1] if nums else 0) + 1)) - set(nums))
        if gaps:
            col.add("DRM-ATT-51", f"SpaceNumbers are not progressive: {', '.join(map(str, gaps[:20]))} not used.",
                    "Number spaces 1, 2, 3 ... (QC key note 8). Notification only: gaps were accepted in DRM-passed "
                    "drawings.", layer="SpaceDetail")
    for no, n in unit_nos.items():
        if n > 1:
            col.add("DRM-ATT-04", f"UnitNumber {no} is used by {n} units.", "Give every unit a unique number.",
                    layer="UnitDetail", handles=[u.handle for u in units if _val(u, "UnitNumber") == no])
    for no, n in space_nos.items():
        if n > 1:
            col.add("DRM-ATT-05", f"SpaceNumber {no} is used by {n} spaces in this floor.",
                    "Give every space a unique number in the floor.", layer="SpaceDetail",
                    handles=[s.handle for s in spaces if _val(s, "SpaceNumber") == no])
    for label, recs, tag in (("UnitDetail", units, "UnitNumber"), ("SpaceDetail", spaces, "SpaceNumber")):
        for r in recs:
            v = _val(r, tag)
            if v and not POS_INT.match(v):
                col.add("DRM-SPEC-IDS", f"{tag} '{v}' is not a positive integer.", "Use 1, 2, 3 ... only.",
                        **_kw(r, label))
    for layer in ("SpaceDetail", "DoorDetail", "WindowDetail", "UnitDetail"):
        for r in _details(records, target, layer):
            fv = _val(r, "FloorNumber")
            if floor_no and fv and fv != floor_no:
                col.add("DRM-ATT-11", f"FloorNumber '{fv}' differs from the FloorDetail floor '{floor_no}'.",
                        f"Set FloorNumber to {floor_no}.", **_kw(r, layer))
            if layer != "UnitDetail":
                uv = _val(r, "UnitNumber")
                if uv and uv not in unit_nos:
                    col.add("DRM-ATT-08", f"UnitNumber '{uv}' does not exist in any UnitDetail of this floor.",
                            "Use the number of the unit that contains this feature, or leave it empty.",
                            **_kw(r, layer))
            if layer in ("DoorDetail", "WindowDetail"):
                key = (_val(r, "SpaceNumber"), _val(r, "UnitNumber"), _val(r, "FloorNumber"))
                if all(key) and key in space_keys:
                    continue
                if not key[0]:
                    why = "SpaceNumber is empty"
                elif key[0] not in space_nos:
                    why = f"SpaceNumber '{key[0]}' does not exist in any SpaceDetail of this floor"
                elif not all(key[1:]):
                    why = (f"UnitNumber/FloorNumber is empty, so SpaceNumber '{key[0]}' cannot be matched to a "
                           "SpaceDetail (the official QC matches the space within its unit and floor)")
                else:
                    why = (f"no SpaceDetail has SpaceNumber '{key[0]}' with UnitNumber '{key[1]}' and FloorNumber "
                           f"'{key[2]}'")
                col.add("DRM-ATT-15", why + ".", "Use the number, unit and floor of the space this "
                        f"{layer.removesuffix('Detail').lower()} belongs to.",
                        official_qc_error=f"Incorrect SpaceNumber found in {layer} attribute block", **_kw(r, layer))


def _space_unit(records, target, ctx: FeatureContext, tol: Tolerances, col: Collector) -> None:
    """QC 4.4 #15: a space outside all units must not carry a UnitNumber; inside, it must match the unit."""
    units = [(f, next((_val(d, "UnitNumber") for d in f.details if target.get(d.handle) == "UnitDetail"), ""))
             for f in ctx.features.get("Unit", []) if f.area_geom is not None]
    for sp in ctx.features.get("Space", []):
        if sp.area_geom is None:
            continue
        det = next((d for d in sp.details if target.get(d.handle) == "SpaceDetail"), None)
        if det is None:
            continue
        uv = _val(det, "UnitNumber")
        # Calibrated on the accepted samples: a space belongs to the unit that holds most of its area
        # (a space slightly overhanging its unit is reported separately as DRM-LOG-21).
        area = sp.area_geom.area or 1.0
        inside = [no for f, no in units if f.area_geom.intersection(sp.area_geom).area > 0.5 * area]
        if uv and not inside:
            col.add("DRM-LOG-15", f"Space carries UnitNumber '{uv}' but lies in no Unit polygon.",
                    "Clear UnitNumber, or draw/extend the Unit polygon around this space.", **_kw(det, "SpaceDetail"))
        elif inside and uv and uv not in inside:
            col.add("DRM-LOG-15", f"Space lies in unit {', '.join(sorted(set(inside)))} but carries UnitNumber '{uv}'.",
                    "Enter the number of the unit that contains this space.", **_kw(det, "SpaceDetail"))
        elif inside and not uv:
            col.add("DRM-LOG-15", f"Space lies in unit {', '.join(sorted(set(inside)))} but UnitNumber is empty.",
                    "Enter the unit number for spaces inside a unit (spec §1.4.6.1.5).",
                    severity=Severity.WARNING, **_kw(det, "SpaceDetail"))


PARENT = [("Floor", "BuildingOutline"), ("Space", "Floor"), ("Unit", "Floor"), ("BuildingOutline", "Plot")]


def _containment(ctx: FeatureContext, tol: Tolerances, col: Collector) -> None:
    for child, parent in PARENT:
        parents = [p.area_geom for p in ctx.features.get(parent, []) if p.area_geom is not None]
        if not parents:
            continue
        for f in ctx.features.get(child, []):
            g = f.area_geom
            if g is None:
                continue
            outside = min(g.difference(p).area for p in parents)
            if outside > tol.overlap_area:
                col.add("DRM-LOG-21", f"{child} extends {outside:.4f} m² outside its {parent} polygon.",
                        f"Correct the {child} or {parent} boundary so the {child} lies within the {parent}.",
                        handle=f.handle, layer=child, entity_type=f.rec.structure, location=f.rec.location,
                        outside_area=outside)
    spaces = [s.area_geom for s in ctx.features.get("Space", []) if s.area_geom is not None]
    for layer in ("Door", "Window"):
        for f in ctx.features.get(layer, []):
            if f.area_geom is not None and spaces and min(f.area_geom.distance(s) for s in spaces) > tol.coincidence:
                col.add("DRM-LOG-21", f"{layer} touches no Space polygon.",
                        f"Snap the {layer.lower()} to the space it opens into.", handle=f.handle, layer=layer,
                        entity_type=f.rec.structure, location=f.rec.location)


def _zero_insertion(records, target, specs: dict[str, LayerSpec], col: Collector) -> None:
    for r in records:
        tl = target.get(r.handle)
        if r.dxftype == "INSERT" and tl and (tl in specs and specs[tl].is_detail or tl == "Title") and r.location \
                and math.hypot(*r.location) < 1e-9:
            col.add("DRM-ATT-02", "Attribute block inserted at the default origin 0,0.",
                    "Place the block inside its polygon (spec rule 6).", **_kw(r, tl))


def _code_lists(records, target, manifest: Manifest, col: Collector) -> None:
    # The official QC reports an EMPTY coded value as "Incorrect ... data entry" (trial 01 rows 14-15), in addition
    # to the empty mandatory field. Non-empty values outside the list are reported by the generic domain check.
    for r in _details(records, target, "BuildingDetail"):
        for tag in ("UsageType", "UsageCategoryType"):
            if not _val(r, tag):
                col.add("DRM-ATT-45", f"{tag} is empty; it must be a value from the BDMS code list.",
                        f"Choose {tag} from the code list (QC manual Appendix 1).",
                        official_qc_error=f"Incorrect {tag} data entry found in BuildingDetail attribute block",
                        tag=tag, **_kw(r, "BuildingDetail"))
    usage = set(manifest.codelists.get("unit_usage_type", []))
    classes = set(manifest.domains.get("unit_classification_suggested", []))
    for r in _details(records, target, "UnitDetail"):
        v = _val(r, "UnitUsageType")
        if v and usage and v not in usage:
            ci = next((x for x in usage if x.lower() == v.lower()), None)
            col.add("DRM-ATT-44", f"UnitUsageType '{v}' is not a UPC land-use term"
                    + (f" (exact spelling: '{ci}')." if ci else "."),
                    "Use a UPC Land Use Classification term from Level 2 or above (spec Appendix C).",
                    **_kw(r, "UnitDetail"))
        c = _val(r, "UnitClassification")
        if c and classes and c not in classes:
            col.add("DRM-ATT-46", f"UnitClassification '{c}' is not one of the listed terms (notification only).",
                    "Confirm the term is meaningful for property classification and has no special characters.",
                    **_kw(r, "UnitDetail"))


# --------------------------------------------------------------------------- official QC parity (trial 01)
KEY_FIELDS = {"PlotDetail": "PlotNumber", "BuildingDetail": "BuildingNumber", "BuildingRoofDetail": "BuildingNumber",
              "FloorDetail": "FloorNumber", "UnitDetail": "UnitNumber", "SpaceDetail": "SpaceNumber"}
SINGLE_INSTANCE = ("Plot", "BuildingOutline", "BuildingRoof", "Floor")
ENTRY_CHECKED = ("SpaceDetail", "WindowDetail")


def _blocks_in_polygons(records, target, specs: dict[str, LayerSpec], ctx: FeatureContext, col: Collector) -> None:
    """QC 4.2 #2 and 4.4 #1. A Detail block whose key field is empty does not count as the polygon's block
    (trial 01: BuildingOutline, Floor and the two spaces with empty SpaceNumber were all reported)."""
    for name, spec in specs.items():
        key = KEY_FIELDS.get(spec.detail or "")
        if not spec.is_geometry or not key:
            continue
        polys = ctx.features.get(name, [])
        valid = 0
        for p in polys:
            own = [d for d in p.details if target.get(d.handle) == spec.detail]
            if not own:
                continue                      # reported by DRM-ATT-01 (no block inside the polygon)
            if any(_val(d, key) for d in own):
                valid += 1
                continue
            col.add("DRM-ATT-48", f"{name} polygon's {spec.detail} block has an empty {key}, so the polygon has no "
                    "valid attribute block.", f"Enter {key} in the {spec.detail} block.", handle=p.handle,
                    layer=name, entity_type="LWPOLYLINE", location=own[0].location, block=own[0].handle)
        if name in SINGLE_INSTANCE and polys and valid != len(polys):
            col.add("DRM-LOG-01", f"{len(polys)} {name} polygon(s) but {valid} valid {spec.detail} block(s).",
                    f"Insert one {spec.detail} block with its {key} inside each {name} polygon.", layer=spec.detail)


def _space_number_entry(records, target, col: Collector) -> None:
    """Trial 01 rows 10-11: SpaceNumber entered but the entry is incomplete or not a positive integer."""
    for layer in ENTRY_CHECKED:
        for r in _details(records, target, layer):
            sv, fv = _val(r, "SpaceNumber"), _val(r, "FloorNumber")
            if not sv:
                continue                      # empty SpaceNumber: DRM-ATT-48 (spaces) / DRM-ATT-15 (windows)
            if not POS_INT.match(sv):
                if layer == "SpaceDetail":
                    continue                  # DRM-SPEC-IDS, counted under the same official row
                why = f"SpaceNumber '{sv}' is not a positive integer"
            elif not fv:
                why = f"SpaceNumber '{sv}' is entered without its FloorNumber"
            else:
                continue
            col.add("DRM-ATT-49", why + ".", "Enter SpaceNumber as 1, 2, 3 ... together with FloorNumber "
                    "(and UnitNumber when the space is in a unit).",
                    official_qc_error=f"Incorrect SpaceNumber data entry found in {layer} attribute block",
                    **_kw(r, layer))


def _official_qc_counting(col: Collector) -> None:
    """Count like the official report: one per file / block / polygon per (error, layer), not one per field."""
    for f in col.findings:
        d = f.details
        if f.rule_id in ("DRM-GEN-01", "DRM-GEN-02"):
            d["qc_unit"] = "file name"
        elif f.rule_id == "DRM-ATT-03" and f.layer:
            if f.layer in ("SpaceDetail", "DoorDetail", "WindowDetail"):
                # Trial 01: the official QC raised no "Missing Value" row for these blocks (empty FloorNumber on
                # all 63, empty Spaceusage on 3); it reports them as SpaceNumber data-entry / link errors instead.
                d["official_qc_error"] = None
            elif f.layer in ("ProjectDetail", "DrawingDetail", "Title"):
                d["official_qc_error"] = f"Missing Value in the Attribute Block Mandatory Filed in {f.layer} " \
                                         "attribute block (not reported by the official QC in trial 01)"
                d["qc_unit"] = f.handle
            else:
                d["official_qc_error"] = f"Missing Value in the Attribute Block Mandatory Filed in {f.layer} " \
                                         "attribute block"
                d["qc_unit"] = f.handle
        elif f.rule_id == "DRM-SPEC-IDS" and f.layer == "SpaceDetail":
            d["official_qc_error"] = "Incorrect SpaceNumber data entry found in SpaceDetail attribute block"
        elif f.rule_id == "DRM-ATT-01" and "has no" in f.message:
            d["official_qc_error"] = "Polygon with missing Attribute Block found"
        elif f.rule_id == "DRM-ATT-45" and d.get("tag") and f.layer and "official_qc_error" in d \
                and "/" in str(d["official_qc_error"]):
            d["official_qc_error"] = f"Incorrect {d['tag']} data entry found in {f.layer} attribute block"


def _one_floor(records, target, ctx: FeatureContext, col: Collector) -> None:
    floors = _details(records, target, "FloorDetail")
    numbers = {_val(f, "FloorNumber") for f in floors}
    buildings = ctx.features.get("BuildingOutline", [])
    if len(numbers) > 1:
        col.add("DRM-SPEC-ONEFLOOR", f"The file contains {len(numbers)} floors: {', '.join(sorted(numbers))}.",
                "Deliver one file per floor.", layer="FloorDetail")
    if len(floors) > 1 or len(ctx.features.get("Floor", [])) > 1:
        col.add("DRM-SPEC-ONEFLOOR", f"{len(ctx.features.get('Floor', []))} Floor polygons / {len(floors)} FloorDetail "
                "blocks; a floor file holds one floor.", "Keep one Floor polygon and one FloorDetail per file.",
                layer="Floor")
    if len(buildings) > 1:
        col.add("DRM-SPEC-ONEFLOOR", f"{len(buildings)} BuildingOutline polygons; a file holds one building.",
                "Deliver each building in its own files.", layer="BuildingOutline")
