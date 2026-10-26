"""Drawing-level and entity-type checks (units, hygiene, prohibited objects, layers, title)."""
from __future__ import annotations

import re
from collections import defaultdict

from ezdxf.document import Drawing

from m4adm.classify import (
    CURVE_TYPES, PROHIBITED_TYPES, PROXY_TYPES, TEXT_TYPES, THREE_D_TYPES, EntityRecord,
    paperspace_entity_count, unused_block_names, unused_linetypes, xref_block_names,
)
from m4adm.models import Severity
from m4adm.rules import LayerSpec, Manifest
from m4adm.validate import Collector

ARABIC = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
UNSUPPORTED_TYPES = {"POINT", "IMAGE", "OLE2FRAME", "OLEFRAME", "WIPEOUT", "LEADER", "MLEADER", "MULTILEADER",
                     "TOLERANCE", "RAY", "TRACE", "MLINE", "PDFUNDERLAY", "DWFUNDERLAY", "DGNUNDERLAY",
                     "HELIX", "SHAPE", "ARC_DIMENSION", "LIGHT", "SUN", "VIEWPORT", "ACAD_TABLE", "TABLE"}
INSUNITS_NAMES = {0: "unitless", 1: "inches", 2: "feet", 4: "millimetres", 5: "centimetres", 6: "metres",
                  14: "decimetres"}


def layer_spec_for(manifest: Manifest, categories: list[str], name: str) -> LayerSpec | None:
    for cat in categories:
        spec = manifest.layer(cat, name)
        if spec is not None:
            return spec
    return None


def check_units(doc: Drawing, units_confirmed: bool, col: Collector) -> None:
    ins = doc.header.get("$INSUNITS", 0)
    want = col.manifest.units.get("insunits")
    if want is not None and ins != want:
        col.add(
            "ADM-UNIT-001",
            f"Drawing insertion units are {INSUNITS_NAMES.get(ins, ins)} ($INSUNITS={ins}); metres are required.",
            "Confirm the geometry is drawn at full scale in metres (one unit = one metre). If it is, tick "
            "'units confirmed' and the prepared file will declare metres. If it is not, rescale in CAD - "
            "the tool never rescales geometry.",
        )
    if not units_confirmed:
        col.add(
            "USR-UNIT-001",
            "The engineer has not confirmed that the drawing is at full scale in metres.",
            "Check a known dimension (e.g. a plot frontage) and tick 'units confirmed (metres)'.",
            blocking=True,
        )
    lunits = doc.header.get("$LUNITS", 2)
    want_l = col.manifest.units.get("lunits")
    if want_l is not None and lunits != want_l:
        col.add("ADM-UNIT-002", f"Length unit type $LUNITS={lunits}; Decimal (2) is shown in Figure 1.",
                "The prepared file sets $LUNITS=2 (display setting only, logged).")


def check_hygiene(doc: Drawing, col: Collector, in_scope_layers: set[str]) -> None:
    groups = list(doc.groups)
    if groups:
        col.add("ADM-CAP-007", f"Drawing contains {len(groups)} group object(s): "
                + ", ".join(name for name, _ in groups[:10]),
                "Ungroup all groups in CAD (GROUP / UNGROUP) before submission.", count=len(groups))
    for name in xref_block_names(doc):
        col.add("ADM-CAP-007", f"External reference (xref) '{name}' is attached.",
                "Detach the xref, or bind and explode it into compliant objects on ADM layers.", block=name)
    unused = unused_block_names(doc)
    if unused:
        col.add("ADM-CAP-007B", f"{len(unused)} unused block definition(s): {', '.join(unused[:15])}"
                + (" ..." if len(unused) > 15 else ""),
                "Purge unused blocks. The prepared output omits unreferenced block definitions (logged).",
                blocks=unused)
    unused_lt = unused_linetypes(doc)
    if unused_lt:
        col.add("ADM-CAP-007B", f"{len(unused_lt)} unused linetype(s): {', '.join(unused_lt[:15])}",
                "Purge unused linetypes in CAD (PURGE).", linetypes=unused_lt)
    proxies = [o for o in doc.objects if o.dxftype() == "ACAD_PROXY_OBJECT"]
    if proxies:
        col.add("ADM-CAP-010", f"Drawing contains {len(proxies)} proxy object(s).",
                "Remove proxy objects (e.g. with the application that created them, or -EXPORTTOAUTOCAD).")
    ps = paperspace_entity_count(doc)
    if ps:
        col.add("ENG-GEO-006", f"{ps} paper-space entities were not checked.",
                "Only model space is prepared and checked; review layouts separately if they matter.")


def check_layer_properties(doc: Drawing, col: Collector, specs: dict[str, LayerSpec]) -> None:
    for name, spec in specs.items():
        if name not in doc.layers:
            continue
        layer = doc.layers.get(name)
        diffs = []
        if abs(layer.color) != spec.color:
            diffs.append(f"colour {abs(layer.color)} (expected {spec.color})")
        lt = layer.dxf.get("linetype", "Continuous")
        if lt.lower() != spec.linetype.lower():
            diffs.append(f"linetype {lt} (expected {spec.linetype})")
        lw = layer.dxf.get("lineweight", -3)
        if lw not in spec.accepted_lineweights:
            diffs.append(f"lineweight {lw} (expected {spec.lineweight_dxf})")
        if diffs:
            known_lt = {lt.dxf.name.lower() for lt in doc.linetypes} | {"dashed"}
            action = "The prepared file sets the specified layer properties (layer table only, logged)."
            if spec.linetype.lower() not in known_lt:
                action = (f"Linetype '{spec.linetype}' is defined only in the official ADM template and is not "
                          "fabricated: load it from the template. Colour/lineweight are set in the prepared file.")
            col.add("ADM-LYR-002", f"Layer {name}: " + "; ".join(diffs) + ".", action, layer=name)


def check_entity_roles(records: list[EntityRecord], target: dict[str, str | None], manifest: Manifest,
                       categories: list[str], col: Collector) -> None:
    """Evaluate each in-scope entity by the role of the ADM layer it is mapped to."""
    for r in records:
        tl = target.get(r.handle)
        if tl is None:
            continue
        spec = layer_spec_for(manifest, categories, tl)
        if spec is None:
            continue
        kw = dict(handle=r.handle, layer=tl, entity_type=r.structure, location=r.location)
        t = r.dxftype
        prohibited = set(manifest.prohibited_entities or PROHIBITED_TYPES)
        if t in prohibited:
            col.add("ADM-CAP-007", f"{t} entity is not allowed in the submission.",
                    "Redraw as an LWPOLYLINE on the correct layer (e.g. PEDIT/JOIN lines into a polyline)."
                    if t == "LINE" else f"Remove the {t} or convert it to compliant objects.", **kw)
            continue
        if t in CURVE_TYPES:
            col.add("ADM-CAP-005", f"{t} entity is not allowed; curves must be digitised as polyline vertices.",
                    "Convert to an LWPOLYLINE with vertices spaced to follow the curve (spec Figure 2).", **kw)
            continue
        if t == "CIRCLE":
            col.add("ENG-GEO-001", "CIRCLE entity: circular features should be a closed LWPOLYLINE with vertices.",
                    "Replace with a closed LWPOLYLINE digitised along the circle.", **kw)
            continue
        if t in PROXY_TYPES:
            col.add("ADM-CAP-010", "Proxy entity is not allowed.", "Remove or explode the proxy entity.", **kw)
            continue
        if t in THREE_D_TYPES or r.structure in ("POLYLINE3D", "POLYMESH", "POLYFACE"):
            col.add("ADM-CAP-009", f"3D object ({r.structure}) is not allowed.",
                    "Replace with a 2D LWPOLYLINE at elevation 0.", **kw)
            continue
        if t in TEXT_TYPES and spec.topology not in ("title", "mixed"):
            col.add("ADM-ATT-010", f"{t} entity is not allowed outside the Title layer.",
                    "Move the information into the feature's attribute block, or delete the text.", **kw)
            continue
        if t == "INSERT":
            if r.block_missing:
                col.add("ADM-CAP-010", f"INSERT references missing block '{r.block_name}'.",
                        "Remove the reference or restore the block definition.", **kw)
                continue
            if r.is_xref:
                col.add("ADM-CAP-007", f"INSERT of external reference '{r.block_name}'.",
                        "Detach or bind the xref.", **kw)
                continue
        if t in UNSUPPORTED_TYPES:
            col.add("ENG-GEO-005", f"{t} entity is not described by the specification.",
                    "Remove it or confirm with ADM SDD that it is acceptable.", **kw)
            continue
        if r.overrides:
            col.add("ENG-GEO-003", "Entity overrides layer properties: "
                    + ", ".join(f"{k}={v}" for k, v in r.overrides.items()),
                    "Set colour, linetype and lineweight to BYLAYER (fix BYLAYER can be accepted in review).",
                    **kw, overrides=r.overrides)
        if spec.topology == "polyline":
            if t == "INSERT":
                col.add("ADM-LYR-005", f"Block '{r.block_name}' on geometry layer {tl}.",
                        f"Move attribute blocks to {spec.detail}; layer {tl} must contain polylines only.", **kw)
            elif t == "DIMENSION":
                col.add("ADM-LYR-005", f"Dimension on geometry layer {tl}.", "Move dimensions to DimensionLine.", **kw)
            elif r.structure == "POLYLINE2D":
                col.add("ADM-CAP-003", "2D POLYLINE (heavy polyline) used; the specification requires LWPOLYLINE.",
                        "Convert with CONVERTPOLY (or accept the lossless TO_LWPOLYLINE fix in review).", **kw)
        elif spec.is_detail:
            if t != "INSERT":
                col.add("ADM-LYR-005", f"{r.structure} on attribute-block layer {tl}; only attribute blocks belong here.",
                        f"Move this object to the geometry layer {spec.parent} or remove it.", **kw)
            elif not r.attribs:
                col.add("ADM-LYR-005", f"Block '{r.block_name}' on {tl} has no attributes.",
                        f"Insert the predefined '{spec.block}' attribute block from the official template.", **kw)
        elif spec.topology == "dimension":
            if t != "DIMENSION":
                col.add("ADM-LYR-003", f"{r.structure} on DimensionLine; this layer must contain AutoCAD dimensions.",
                        "Move the object to its proper layer or replace it with a dimension.", **kw)
        elif spec.topology == "mixed":
            if t not in ("LWPOLYLINE", "INSERT", "TEXT", "MTEXT", "ATTDEF"):
                col.add("ADM-LYR-005", f"{r.structure} on layer {tl}; only polylines, blocks and text belong here.",
                        "Remove it or convert it to an LWPOLYLINE.", **kw)
        elif spec.topology == "title":
            if r.is_polyline_like and not r.closed:
                col.add("ADM-LYR-006", "Open polyline on the Title layer (Title is specified as closed polylines).",
                        "Close the border polyline; confirm against the official template.", severity=Severity.WARNING,
                        **kw)


def check_title(records: list[EntityRecord], target: dict[str, str | None], col: Collector) -> None:
    tb = col.manifest.title_block
    tags = {f["tag"].upper() for f in tb["fields"]}
    candidates = [r for r in records if target.get(r.handle) == tb["layer"] and r.dxftype == "INSERT"
                  and tags & set(r.attribs_upper)]
    if not candidates:
        col.add("ADM-TTL-001", "No Title attribute block (with the Table 4 fields) found on layer Title.",
                "Insert the title attribute block from the official ADM template on layer Title and fill it in. "
                "The tool does not create title blocks without the template.")
        return
    if len(candidates) > 1:
        col.add("ADM-TTL-001", f"{len(candidates)} Title attribute blocks found; exactly one is expected per file.",
                "Keep a single title attribute block per drawing file.", severity=Severity.ERROR,
                handles=[c.handle for c in candidates])
    for r in candidates:
        att = r.attribs_upper
        names = [att.get(n.upper(), "").strip() for n in tb["at_least_one_of"]]
        if not any(names):
            col.add("ADM-TTL-002", "Title block has neither MainConsultantName nor MainContractorName filled in.",
                    "Fill in at least the main consultant or main contractor name (in English).",
                    handle=r.handle, layer="Title", location=r.location)
        arabic = [k for k, v in att.items() if k in tags and ARABIC.search(v or "")]
        if arabic:
            col.add("ADM-TTL-003", f"Title fields contain Arabic script: {', '.join(arabic)}.",
                    "Enter title block details in English.", handle=r.handle, layer="Title", location=r.location)


def check_shared_layers(records: list[EntityRecord], target: dict[str, str | None], categories: list[str],
                        col: Collector) -> None:
    if len(categories) < 2:
        return
    counts: dict[str, int] = defaultdict(int)
    for r in records:
        tl = target.get(r.handle)
        if tl in ("Title", "DimensionLine"):
            counts[tl] += 1
    for layer, n in counts.items():
        col.add("ENG-SHARED-001",
                f"{n} entities on shared layer {layer} are copied into each of the {len(categories)} dataset files.",
                "Confirm each dataset file should carry this content, or assign entities per file with handle mappings.",
                layer=layer, count=n)
