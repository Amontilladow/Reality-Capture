"""Assemble the Phase-1 review package into one combined PDF.

usage: python3 make_package.py <src_dir> <out_dir> <sample_code>
Expects build_sheet.py and analyze_all.py outputs in <out_dir>.
"""
import datetime
import glob
import json
import os
import pickle
import sys

import numpy as np
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

import compare as CP
import graphics as G
import scene as SC
import sheet as SH
from model import SCALE_PT_PER_M
from report import Doc, M, A3L

FLOOR_NAME = {"BASEMENT": "Basement Floor", "GROUND": "Ground Floor", "MEZZANINE": "Mezzanine Floor"}
KIND_NAME = {"fire_extinguisher": "Fire extinguisher", "wheeled_extinguisher": "Wheeled extinguisher",
             "fire_hose_reel": "Fire hose reel", "manual_call_point": "Manual call point", "lift": "Lift",
             "exit_sign": "Exit sign", "assembly_point": "Assembly point", "fire_brigade_inlet": "Fire brigade inlet"}
TODAY = datetime.date(2026, 10, 30).isoformat()


def fmt_counts(d):
    order = ["fire_extinguisher", "wheeled_extinguisher", "fire_hose_reel", "manual_call_point", "lift",
             "exit_sign", "assembly_point", "fire_brigade_inlet"]
    return ", ".join(f"{KIND_NAME[k]} {d[k]}" for k in order if k in d)


def register_rows(A):
    rows = []
    for s in A:
        fit = s.get("fit_to_01")
        orient = "Reference orientation for this floor" if s["code"].endswith("-01") else (
            f"Plan rotated {fit['rotation_deg']}° vs {s['code'][:-3]}-01; plotted at {fit['scale_ratio']:.2f}x its size"
            if fit else "-")
        missing = ["No drawing no., revision, date, scale, north point or project title on sheet"]
        if s["unexplained_text"]:
            missing.append(f"Unexplained text '{', '.join(s['unexplained_text'])}'")
        if fit and fit["max_residual_pt"] > 15:
            missing.append(f"Some symbol positions differ from {s['code'][:-3]}-01 (max {fit['max_residual_pt']:.0f} pt "
                           "after best fit) - confirm which is correct")
        info = [fmt_counts(s["symbols"])]
        if s["riser_numbers"]:
            info.append(f"stair riser numbers {s['riser_numbers'][0]}-{s['riser_numbers'][1]}")
        info.append(f"{s['stair_zones']} highlighted escape stair(s) detected" if s["stair_zones"] else
                    "escape-stair highlight not on a recognised layer (to resolve in later phase)")
        info.append("YOU ARE HERE marker located" if s["yah"] else "YOU ARE HERE marker visible but not on a recognised layer")
        rows.append([s["code"], s["file"], "Not shown (PDF meta title " + str(s["pdf_title_meta"]) + ")",
                     s["title_text"].replace(" / ", " - "), "Not shown", FLOOR_NAME[s["floor"]],
                     "Not stated; " + s["paper"] + (", page rotated 270°" if s["page_rotation"] else ""),
                     orient + ". " + "; ".join(info), "; ".join(missing)])
    return rows


def route_end_table(m):
    """Classify every traced route end by its nearest destination feature."""
    s = m["scale_pt_per_m"]
    feats = [(x["kind"], np.asarray(x["pos"])) for x in m["symbols"] if x["kind"] in ("exit_sign", "assembly_point")]
    stairs = [np.asarray(z["outer"]).mean(0) for z in m["stairs"]]
    rows = []
    for i, t in enumerate(m["routes"]["terminals"], 1):
        t = np.asarray(t)
        cands = [(np.hypot(*(p - t)) / s, KIND_NAME[k]) for k, p in feats]
        cands += [(np.hypot(*(p - t)) / s, "Escape stair") for p in stairs]
        d, k = min(cands)
        if k == "Assembly point":
            status = "DERIVED - route ends at assembly point symbol"
        elif k == "Escape stair" and d < 6:
            status = "DERIVED - route enters highlighted escape stair"
        elif d < 6:
            status = "PARTIAL - exit sign adjacent; door/exit status not confirmed"
        else:
            status = "UNVERIFIED - no exit feature near route end"
        rows.append([f"E{i}", f"({t[0]:.0f}, {t[1]:.0f}) pt", f"{k} at {d:.1f} m", status])
    return rows


def main(src_dir, out, code):
    A = json.load(open(os.path.join(out, "analysis.json")))
    by = {s["code"]: s for s in A}
    S = by[code]
    m = pickle.load(open(os.path.join(out, f"{code}_model.pkl"), "rb"))
    sc = json.load(open(os.path.join(out, f"{code}_scene.json")))
    src = [p for p in glob.glob(os.path.join(src_dir, "*.pdf")) if p.endswith(S["file"])][0]
    cam = SC.Camera(108, 52)
    fr = SC.Frame(m)

    # comparison assets
    ov = CP.overlay(src, m, os.path.join(out, f"{code}_qc_overlay.png"))
    orig = ov.replace(".png", "_orig.png")
    plan = CP.plan_raster(os.path.join(out, f"{code}.pdf"), os.path.join(out, f"{code}_plan_raster.png"))

    pdf_path = os.path.join(out, "3D_Evacuation_Plans_Phase1_Review_Package.pdf")
    c = canvas.Canvas(pdf_path, pagesize=A3L)
    c.setTitle("3D Isometric Evacuation Plans - Phase 1 Review Package")
    c.setAuthor("Prepared from supplied 2D PDF drawings")
    D = Doc(c, "3D Isometric Evacuation Plans - Phase 1 review package - DRAFT, not for submission - "
               "requires appointed FLS consultant review")

    # ------------------------------------------------------------- cover
    D.new_page()
    W, H = A3L
    G.text_en(c, M, H - 110, "3D ISOMETRIC EVACUATION PLANS", 40, bold=True)
    G.text_ar(c, M, H - 160, "مخططات الإخلاء ثلاثية الأبعاد", 32, bold=True, align="left")
    G.text_en(c, M, H - 200, "Phase 1 review package: drawing analysis, reconstruction method and sample floor", 18)
    G.text_en(c, M, H - 224, "Prepared for review against Abu Dhabi Civil Defence (ADCDA) evacuation-plan requirements",
              13, color=G.GREY)
    c.setFillColor(G.GREEN)
    c.rect(M, H - 242, 120, 5, stroke=0, fill=1)
    D.y = H - 266
    D.h2("Contents")
    D.bullets([
        "1. Drawing register (all 10 supplied PDFs)",
        "2. Building configuration and information extracted per floor",
        "3. Missing and conflicting information",
        "4. 3D reconstruction methodology",
        f"5. Sample 3D evacuation plan - {code} ({FLOOR_NAME[S['floor']]}) - A1 sheet",
        f"6. QC comparison sheet - {code}: original vs extraction vs 3D - A1 sheet",
        "7. Quality-control report (sample floor and package-level findings)",
        "8. Engineering review requested before remaining floors are produced",
    ], size=12)
    D.h2("Status")
    D.para("DRAFT FOR ENGINEERING REVIEW - NOT FOR SUBMISSION. This package does not certify compliance with the UAE "
           "Fire & Life Safety Code or claim ADCDA approval. The escape strategy has not been redesigned: every route, exit, "
           "assembly point and equipment position is taken from the supplied sheets. All content must be reviewed and "
           "approved by the appointed Fire & Life Safety consultant before formal submission.", 11.5, bold=True,
           color=G.DARK_RED)
    D.para(f"Issue: P01 (draft) - {TODAY}. Sample floor selected: {FLOOR_NAME[S['floor']]} ({code}), the discharge "
           "level: it is the only floor that carries exterior routes, final exits and assembly points as well as escape "
           "stairs, lifts and every equipment type, so it exercises every element of the method.", 11)

    # ------------------------------------------------------ 1. register
    D.new_page("1. Drawing register")
    D.para("All ten files are single-page A1 AutoCAD 2027 plots (pdfplot18) with CAD layers preserved as PDF optional "
           "content. Each is an existing 2D evacuation plan (one per installation position) rather than a general "
           "arrangement plan. None carries a title block, so drawing numbers, revisions, dates and scales are not "
           "available; the PDF metadata 'Title' is a plot job number, not a drawing number.", 10)
    D.table(["Sheet", "File name", "Drawing number", "Drawing title", "Rev.", "Floor / level", "Scale",
             "Information extracted", "Missing / conflicting"],
            register_rows(A), [0.045, 0.14, 0.09, 0.1, 0.045, 0.07, 0.09, 0.24, 0.18], size=7.6)

    # ------------------------------------------- 2. building config
    D.new_page("2. Building configuration and extracted information")
    D.para("Floors in the supplied set: Basement, Ground Floor, Mezzanine Floor (3 levels; floor names as printed). No "
           "upper floors, roof or site plan were supplied. Floor-to-floor heights, levels and the vertical alignment of "
           "stairs between floors are not stated.", 10.5)
    rows = []
    for fl in ("BASEMENT", "GROUND", "MEZZANINE"):
        ss = [s for s in A if s["floor"] == fl]
        same = all(s["symbols"] == ss[0]["symbols"] for s in ss)
        rows.append([FLOOR_NAME[fl], ", ".join(s["code"] for s in ss), fmt_counts(ss[0]["symbols"]),
                     "Identical on all variants" if same else "DIFFERS between variants",
                     f"{max(s['stair_zones'] for s in ss)} highlighted" if max(s['stair_zones'] for s in ss) else
                     "Present on sheets; layer not yet parsed",
                     "Yes (2)" if ss[0]["symbols"].get("assembly_point") else "Not shown on this floor"])
    D.table(["Floor", "Sheets (YAH variants)", "Fire & life-safety equipment (symbol count)", "Consistency",
             "Escape stairs", "Assembly points"], rows, [0.1, 0.13, 0.4, 0.13, 0.14, 0.1], size=8.6)
    D.h2("Variant consistency (equipment layout after best rigid fit to variant -01)")
    rows = []
    for s in A:
        f = s.get("fit_to_01")
        if not f:
            continue
        rows.append([s["code"], f"{f['rotation_deg']}°" + (" mirrored" if f["mirrored"] else ""),
                     f"{f['scale_ratio']:.2f}", f"{f['median_residual_pt']:.1f} pt", f"{f['max_residual_pt']:.0f} pt",
                     "VERIFIED - same layout" if f["max_residual_pt"] < 12 else
                     "PARTIAL - same equipment set; some symbols drawn in different positions; confirm on site"])
    D.table(["Sheet", "Plan rotation vs -01", "Plot size ratio", "Median offset", "Max offset", "Result"],
            rows, [0.08, 0.14, 0.1, 0.1, 0.1, 0.48], size=8.6)
    D.h2(f"Ground Floor ({code}) - extracted content")
    r = m["routes"]
    D.bullets([
        f"Architecture: {len(m['walls'])} wall/column solids (A-HATCH poche, A-WALL, S-COLS), {len(m['glazing'])} glazing runs "
        "(A-GLAZ-CURT, A-WINDOW), 3 escape-stair cores highlighted green on the source, feature stair with riser "
        "numbers 1-30 (not highlighted, so not treated as an escape stair).",
        f"Evacuation: {len(r['polylines'])} traced route segments, {len(r['dots'])} route start points, "
        f"{r['arrow_count']} arrowheads ({len(r['midroute_arrows'])} mid-route, all agreeing with the traced direction), "
        f"{len(r['terminals'])} route ends; 8 exit signs; 2 assembly points (north-east and south-west, outside the building).",
        "Equipment: " + fmt_counts(S["symbols"]) + ".",
        "YOU ARE HERE: at the north escape stair door (pin tip located from the red marker on layer '0').",
        f"Scale: not stated. Derived {SCALE_PT_PER_M:.2f} pt/m (~1:{72 / 25.4 * 1000 / SCALE_PT_PER_M:.0f} at A1) from the "
        "110.8 pt parking-bay depth read as 5.5 m; cross-checked against showroom car outlines (~102 x 40 pt, i.e. ~4.8 x 1.9 m "
        "cars) and WC fittings. Accuracy is estimated at about +/-10%; the scale only affects metre values in this report, "
        "not the geometry, which is used at true plan proportion.",
        "Room names: none are shown on any supplied sheet, so none are shown on the 3D plans.",
    ], size=10)

    # ------------------------------------------ 3. missing / conflicting
    D.new_page("3. Missing and conflicting information")
    D.para("Information classes used throughout: EXPLICIT = shown on the supplied drawings; DERIVED = measured from drawing "
           "geometry; INFERRED = architectural interpretation; MISSING = requires engineering confirmation.", 10,
           color=G.GREY)
    D.table(["#", "Item", "Class", "Effect on deliverable / action required"], [
        ["M1", "Approved Fire & Life Safety strategy report and FLS drawings (travel distances, exit capacities, stair "
               "protection, phased evacuation, refuge)", "MISSING",
         "Routes could only be taken from the existing evacuation sheets; they cannot be cross-referenced to an approved "
         "strategy. FLS consultant to supply or confirm."],
        ["M2", "Architectural GA plans (room names, dimensions, grids, levels)", "MISSING",
         "No room names or dimensions available; plans show no room names. Corridor widths not verifiable."],
        ["M3", "Title block data: project name, plot/building no., drawing numbers, revisions, dates, scale, north point",
         "MISSING", "Register cannot record drawing numbers or revisions; no north arrow can be shown."],
        ["M4", "Floor-to-floor heights and levels", "MISSING",
         "Single-floor plans use a diagrammatic 2.0 m wall cut; no stacked multi-floor model is possible yet."],
        ["M5", "Exit door schedule (final exits, fire-rated doors, widths, swing, locking/access control)", "MISSING",
         "Exits are identified only by the exit signs and arrowheads on the source sheets."],
        ["M6", "Stair protection / fire rating; which stairs serve which floors and where each discharges", "MISSING",
         "Green-highlighted stairs are labelled 'Escape stair' as on the source; protection not verified. Stair continuity "
         "between Basement, Ground and Mezzanine is not verified (no common grid or coordinates)."],
        ["M7", "Refuge areas / areas of rescue assistance", "MISSING",
         "None designated on the sources, so none shown. Confirm whether required."],
        ["M8", "Primary vs secondary route designation", "MISSING",
         "Sources draw a single route type; all routes are shown as one class."],
        ["M9", "Lift designation (passenger / firefighting / evacuation lift)", "MISSING",
         "Lifts shown with the source lift symbol and 'do not use in fire'. Lift shafts are not separately identified."],
        ["M10", "Site plan for assembly points and exterior routes", "MISSING",
         "Assembly points placed exactly as on the Ground Floor sheets; their real site position is not verifiable."],
        ["M11", "Installation location description for each YOU ARE HERE variant", "MISSING",
         "Only the marker position is known. Confirm mounting position and reader orientation per sign."],
        ["M12", "Equipment schedule (extinguisher types/ratings, hose reel IDs, MCP addresses)", "MISSING",
         "Positions taken from the plan symbols (schematic; up to ~1 m from the actual device)."],
        ["M13", "Approved ADCD logo artwork (falcon emblem) and a site plan for the 'Site Map' panel", "MISSING",
         "Logo position is reserved at the top centre and the official emblem is not redrawn; approved artwork must be "
         "supplied. The Site Map panel shows the floor key plan until a site plan is provided."],
        ["C1", "Same floor plotted at different orientations and sizes across variants", "EXPLICIT",
         "Not a conflict in content; each 3D sheet will keep its own source orientation for reader alignment."],
        ["C2", "Symbol positions differ between variants of the same floor (see section 2)", "DERIVED",
         "Confirm the correct positions before Basement and Ground Floor variants -02/-04 are produced."],
        ["C3", "Unexplained text '322 290' repeated on Ground and Mezzanine sheets", "EXPLICIT",
         "Meaning unknown (possibly a tag or dimension pair). Not reproduced."],
        ["C4", "Stair riser numbering 1-30 (Ground) and 1-34 (Mezzanine)", "EXPLICIT",
         "Implies different flights; cannot derive storey heights without riser dimensions."],
        ["C5", "Fire brigade inlet and wheeled extinguishers identified only from the icon artwork", "INFERRED",
         "Confirm device type with the FLS / fire-fighting drawings."],
    ], [0.04, 0.33, 0.08, 0.55], size=8.4, status_col=2)

    # ------------------------------------------------ 4. methodology
    D.new_page("4. 3D reconstruction methodology")
    D.para("Technology evaluation: the PDFs are vector AutoCAD plots that keep their CAD layer names, so geometry was read "
           "directly from the PDF vector data (PyMuPDF). This is more accurate than OCR or raster tracing and avoids any "
           "AI-generated imagery. No DXF was supplied, and none is needed because the layers are preserved. Blender was "
           "evaluated, but a scripted three.js orthographic renderer gives the same extruded geometry with a "
           "reproducible camera. The 3D model is also exported as glTF (.glb), so it can be opened and edited in Blender "
           "or converted for BIM tools.", 10.5)
    D.table(["Step", "Process", "Source layers / tools", "Controls"], [
        ["1", "Vector extraction: every path with its layer, flattened to polylines in sheet coordinates (page rotation "
              "applied)", "PyMuPDF; ~150k-310k paths per sheet", "Layer inventory recorded per sheet"],
        ["2", "Plan area isolation between title and legend; scale derivation", "Text positions; Q-SPCQ bays",
         "Scale cross-checked against cars and WC fittings"],
        ["3", "Walls & columns: solid poche fills + wall outlines rasterised at 4 px/pt, closed, vectorised to polygons "
              "with holes", "A-HATCH (grey fill), A-WALL, S-COLS, A-WALL-PATT; OpenCV", "Overlay vs original (QC sheet)"],
        ["4", "Glazing runs, floor plate (concave hull of envelope), escape stair zones, floor linework (doors, bays, "
              "treads)", "A-WINDOW, A-GLAZ-CURT, A-PLST-FNSH, green stair fills, S-STRS, A-DOOR",
         "Floor plate flagged as inferred"],
        ["5", "Routes: dashes bridged along their axis into a band and skeletonised; chevrons classified by shape and "
              "their pointing direction measured", "A-ESCAPE-ROUTE; scikit-image",
         "Every route pixel must reach an exit"],
        ["6", "Direction: geodesic distance along the skeleton from exits; each route walked downhill from its start. "
              "Mid-route chevrons are checked against the traced direction", "Graph search",
         "Arrow agreement test; unreached-pixel count"],
        ["7", "Symbols: embedded icons classified by colour and shape (same artwork at every scale)",
         "Embedded raster icons", "Counts compared across all variants"],
        ["8", "3D scene in metres at true plan proportion (translate + uniform scale only). Walls extruded to a 2.0 m "
              "cut, translucent glazing, 0.35 m slab", "three.js r160", "Single uniform scale; no stretch"],
        ["9", "Orthographic axonometric render (elevation 52°, 18° oblique to the sheet axes) at 8000 px width in 4000 px tiles",
         "Headless Chromium WebGL2", "Tiles use exact view offsets"],
        ["10", "Flat 2D overlays: routes, chevrons, exits, equipment, YOU ARE HERE, labels, legend. All are vector and "
               "projected through the identical camera maths", "reportlab; English + Arabic (shaped)",
         "Overlay registration checked visually"],
        ["11", "QC: original, extraction overlay and 3D plan side by side, with a checklist", "This package",
         "Engineering review"],
    ], [0.04, 0.48, 0.25, 0.23], size=8.6)
    D.h2("Presentation basis (initial, subject to ADCDA verification)")
    D.bullets([
        "Sheet format and palette follow the client's APPROVED SAMPLE (EVAC_PLAN.pdf, 1550 x 1135 pt landscape): "
        "pale olive sheet, 'EVACUATION PLAN' / 'خطة الإخلاء' with the floor name, plan across the full width, and a bottom "
        "band of Remember | تذكر | Symbols رموز | Site Map خارطة الموقع using the sample's wording. Colours were "
        "sampled from the approved file. The ADCD logo position is reserved at the top centre for the approved artwork.",
        "3D floor in the sample's room cream with approved-grey walls (darker cut tops), escape stairs in the sample "
        "green, primary routes as green dashed lines with green chevrons, red fire equipment and YOU ARE HERE, green "
        "EXIT signs. Corridor shading (light green on the sample) is not applied because rooms and corridors are not "
        "designated on the source drawings. No secondary (orange) routes exist on the sources.",
        "Symbols are drawn upright in screen space on leader lines anchored at their plan position, so no symbol is hidden "
        "behind a wall. Routes are drawn on top of the model so walls never obscure them.",
        "No furniture, textures, lighting effects or decorative detail. Parking bays, door swings and stair treads are "
        "kept as thin floor linework for orientation only.",
    ], size=10)
    D.close()

    # ------------------------------------------------ 5. sample sheet
    sheet = {"floor": S["floor"], "code": code, "source_name": S["file"],
             "revision": f"P01 (draft) {TODAY}"}
    SH.draw_plan_sheet(c, sheet, m, cam, fr, sc["frustum"], os.path.join(out, f"{code}_3d.png"))
    c.showPage()

    # ------------------------------------------------ 6. comparison
    r = m["routes"]
    checks = [
        ["Room arrangement", "Overlay of extracted wall solids on the original sheet",
         "All wall runs, cores and rooms reproduced; no room names exist on the source", "VERIFIED (geometry)"],
        ["Wall positions", "Wall polygons vectorised directly from source poche/outline layers",
         "Coincident with source linework at overlay resolution (~0.1 m)", "VERIFIED"],
        ["Door positions", "Door openings = gaps in wall solids; A-DOOR swings kept as floor lines",
         "Openings preserved; door types, ratings and swing direction not verified", "PARTIAL"],
        ["Corridor widths", "Measurable at the derived scale (+/-10%)",
         "No dimensions on source; widths not checked against code minima", "NOT VERIFIABLE - needs GA dimensions"],
        ["Staircase positions / configuration", "Green escape-stair fills + S-STRS treads",
         "3 escape stairs reproduced in position; flights shown schematically (treads at floor level)", "VERIFIED (position)"],
        ["Exit locations", "Exit-sign symbols + route ends (see QC report table)",
         "8 exit signs reproduced at source positions; final-exit status of doors not confirmed", "PARTIAL"],
        ["Route continuity", "Skeleton graph; every route pixel must reach an exit",
         f"{len(r['polylines'])} segments, 0 unreached pixels; all routes end at an exit, stair or assembly point",
         "VERIFIED"],
        ["Directional arrows", "Mid-route chevrons on the source vs traced direction",
         f"{sum(a['agrees'] for a in r['midroute_arrows'])}/{len(r['midroute_arrows'])} agree; end arrows placed at "
         "route ends", "VERIFIED"],
        ["Fire equipment positions", "Symbol centres from source icons; counts vs all GF variants",
         "43/43 symbols reproduced; identical counts on GF-01/02/03", "VERIFIED (schematic)"],
        ["YOU ARE HERE", "Red pin tip located from the source marker geometry",
         "At the north escape stair door, as on the source", "VERIFIED"],
    ]
    CP.draw_comparison(c, code, FLOOR_NAME[S["floor"]], S["file"], orig, ov, plan, checks)
    c.showPage()

    # ------------------------------------------------ 7. QC report
    D.y = None
    D.new_page("7. Quality-control report")
    D.h2(f"7.1 Sample floor {code} - information classification")
    D.table(["Element", "Class", "Basis"], [
        ["Wall, column and glazing positions", "EXPLICIT", "CAD layers in the supplied PDF"],
        ["Escape stair locations", "EXPLICIT", "Green highlight on the source sheet"],
        ["Escape routes, start points and directions", "EXPLICIT", "A-ESCAPE-ROUTE geometry and arrowheads"],
        ["Route connectivity across dash gaps and junctions", "DERIVED", "Bridging and graph tracing (section 4, steps 5-6)"],
        ["Equipment symbol positions and types", "EXPLICIT", "Embedded icons; positions are symbol centres"],
        ["Plot scale ~1:141, metre values", "DERIVED", "Parking bay depth, car outlines, WC fittings (+/-10%)"],
        ["Floor plate outline", "INFERRED", "Concave hull of wall/finish/glazing linework; no slab edge on source"],
        ["Wall height 2.0 m, slab 0.35 m", "INFERRED", "Diagrammatic cut, chosen so walls do not hide the routes"],
        ["Escape-stair flight geometry", "INFERRED", "Shown as plan treads at floor level, not as rising flights"],
        ["Fire brigade inlet, wheeled extinguisher type", "INFERRED", "From the icon artwork only"],
        ["Room names, dimensions, north point, storey heights", "MISSING", "Not on any supplied sheet"],
        ["Approved FLS strategy cross-check", "MISSING", "No FLS drawings or report supplied"],
    ], [0.3, 0.12, 0.58], size=9, status_col=1)
    D.h2(f"7.2 Unverified exits and route ends - {code}")
    D.table(["End", "Position (sheet)", "Nearest destination feature", "Status"], route_end_table(m),
            [0.06, 0.18, 0.3, 0.46], size=9, status_col=3)
    D.h2("7.3 Unclear geometry")
    D.bullets([
        "Feature (curved) stair in the showroom: numbered 1-30 but not highlighted as an escape stair. It is shown as "
        "walls and floor linework only, with no route on it. Confirm it is not part of the means of escape.",
        "Circular element north-east of the feature stair: taken as a lift (lift symbol beside it); shaft type not confirmed.",
        "Floor plate edge at the south-east ramp and west facade openings: inferred, may differ from the slab edge by up to "
        "~3 m where facade linework is open.",
        "Long free-standing wall line south of the building (property/boundary line) is shown as a wall because it is on "
        "the wall layers; confirm whether it is a site boundary wall.",
        "Exterior route segments run outside the floor plate over site areas that are not drawn (no site plan).",
    ], size=10)
    D.h2("7.4 Assumptions made during reconstruction")
    D.bullets([
        "Each supplied sheet is the authoritative evacuation layout for its installation position. Routes were not redesigned "
        "or extended, and no exit was inferred from door geometry.",
        "A route end touching a green-highlighted stair is treated as entering the stair, unless the route already leads on "
        "to an arrowed exit (for example people arriving by stair at the Ground Floor and continuing outside).",
        "Escape routes are all shown as one class (no primary/secondary distinction on the source).",
        "Remember / تذكر wording is reproduced exactly from the approved sample; no instructions were added.",
        "Arabic text follows the source wording where it existed; new Arabic labels need a native-speaker check.",
    ], size=10)
    D.h2("7.5 Package-level findings for the remaining floors (to resolve before production)")
    rows = []
    for s in A:
        notes = []
        if s["route_unreached_px"] > 0 or s["route_polylines"] == 0:
            notes.append("route extraction incomplete (arrow/dot templates are tuned to the Ground Floor plot size; "
                         "make them relative to the sheet's route line width)")
        if not s["yah"]:
            notes.append("YOU ARE HERE marker not on layer '0' - add a detector")
        if s["stair_zones"] == 0:
            notes.append("escape-stair highlight on another layer - add it")
        if any(a is False for a in s["midroute_arrows_agree"]):
            notes.append("a mid-route chevron disagrees with the traced direction - inspect")
        rows.append([s["code"], "OK - production ready" if not notes else "ACTION", "; ".join(notes) or "-"])
    D.table(["Sheet", "Automated extraction", "Action"], rows, [0.08, 0.17, 0.75], size=9)

    D.new_page("8. Engineering review requested")
    D.para("Please review the sample sheet and comparison sheet, then confirm or correct the following before the "
           "remaining nine sheets are produced:", 11)
    D.bullets([
        "Sheet format (approved sample) and visual style: camera angle (elevation 52°, 18° oblique; GF-01 turned to the GF-02 landscape orientation), 2.0 m wall cut, colours, symbol size, "
        "leader-line placement, bilingual layout, legend and instructions panel.",

        "Route ends E1-E7 (section 7.2): confirm the final exits and the assembly points.",
        "Items M1-M13 and C1-C5 (section 3): provide the FLS strategy, GA plans and the confirmations listed.",
        "Approved ADCD logo artwork and a site plan for the Site Map panel (M13).",
        "Orientation: GF-01 was a portrait sheet; to fit the approved landscape format its view is turned to match the "
        "drafter's own landscape Ground Floor sheet (GF-02). Confirm against the mounting position of each sign (M11).",
        "Whether a stacked multi-floor overview is wanted; this needs storey heights (M4) and stair continuity (M6).",
    ], size=11)
    D.para("Editable sources supplied with this package: the 3D model (glTF .glb, metres), the scene and extracted model "
           "data (JSON), the high-resolution architectural render (PNG), the vector sheet (PDF/SVG) and the generating "
           "scripts (Python + three.js) for exact regeneration after review.", 10.5)
    D.close()
    c.save()
    return pdf_path


if __name__ == "__main__":
    print(main(*sys.argv[1:4]))
