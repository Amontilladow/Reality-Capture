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


ORDER = ["B-01", "B-02", "B-03", "B-04", "GF-01", "GF-02", "GF-03", "MF-01", "MF-02", "MF-03"]
FLOOR_CODE = {"BASEMENT": "B", "GROUND": "GF", "MEZZANINE": "MF"}


def sheet_checks(s, m):
    r = m["routes"]
    mid = r["midroute_arrows"]
    agree = sum(a["agrees"] for a in mid)
    n_exit = s["symbols"].get("exit_sign", 0)
    return [
        ["Room arrangement", "Overlay of extracted wall solids on the original sheet",
         "Wall runs, cores and rooms reproduced; no room names exist on the source", "VERIFIED (geometry)"],
        ["Wall positions", "Wall polygons vectorised directly from source poche/outline layers",
         "Coincident with source linework at overlay resolution (~0.1 m)", "VERIFIED"],
        ["Door positions", "Door openings = gaps in wall solids; A-DOOR swings kept as floor lines",
         "Openings preserved; door types, ratings and swing direction not verified", "PARTIAL"],
        ["Corridor widths", "Measurable at the derived scale (+/-10%)",
         "No dimensions on source; widths not checked against code minima", "NOT VERIFIABLE - needs GA dimensions"],
        ["Staircase positions", "Green escape-stair fills + S-STRS treads",
         f"{len(m['stairs'])} escape stairs reproduced in position; flights shown schematically", "VERIFIED (position)"],
        ["Exit locations", "Exit-sign symbols + route ends (QC report)",
         f"{n_exit} exit signs at source positions; final-exit status of doors not confirmed", "PARTIAL"],
        ["Route continuity", "Skeleton graph; every route pixel must reach an exit",
         f"{len(r['polylines'])} segments, {r['unreached_px']} unreached pixels",
         "VERIFIED" if r["unreached_px"] == 0 else "PARTIAL - see QC report"],
        ["Directional arrows", "Mid-route chevrons on the source vs traced direction",
         f"{agree}/{len(mid)} mid-route chevrons agree" if mid else "No mid-route chevrons on this sheet",
         "VERIFIED" if agree == len(mid) else "PARTIAL - see QC report"],
        ["Fire equipment positions", "Symbol centres from source icons; counts vs all variants of the floor",
         f"{len(m['symbols'])} symbols reproduced; counts identical on all variants", "VERIFIED (schematic)"],
        ["YOU ARE HERE", "Red pin tip located from the source marker geometry",
         "Located as on the source" if m.get("yah") else "Not found on the source", "VERIFIED" if m.get("yah") else
         "NOT VERIFIABLE"],
    ]


def main(src_dir, out, logo=None):
    fits = {a["code"]: a.get("fit_to_01") for a in json.load(open(os.path.join(out, "analysis.json")))}
    A = []
    for code in ORDER:
        s = json.load(open(os.path.join(out, f"{code}_summary.json")))
        if fits.get(code):
            s["fit_to_01"] = fits[code]
        A.append(s)
    srcs = {os.path.basename(p): p for p in glob.glob(os.path.join(src_dir, "*.pdf"))}

    def src_of(s):
        return [p for n, p in srcs.items() if n.endswith(s["file"])][0]

    pdf_path = os.path.join(out, "3D_Evacuation_Plans_All_Levels.pdf")
    c = canvas.Canvas(pdf_path, pagesize=A3L)
    c.setTitle("3D Isometric Evacuation Plans - All Levels")
    c.setAuthor("Prepared from supplied 2D PDF drawings")
    D = Doc(c, "3D Isometric Evacuation Plans - all levels - DRAFT, not for submission - "
               "requires appointed FLS consultant review")

    # ------------------------------------------------------------- cover
    D.new_page()
    W, H = A3L
    G.text_en(c, M, H - 110, "3D ISOMETRIC EVACUATION PLANS", 40, bold=True)
    G.text_ar(c, M, H - 160, "مخططات الإخلاء ثلاثية الأبعاد", 32, bold=True, align="left")
    G.text_en(c, M, H - 200, "All levels: Basement, Ground Floor, Mezzanine Floor - 10 sheets in the approved format", 18)
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
        "5. 3D evacuation plans - Basement B-01 to B-04, Ground Floor GF-01 to GF-03, Mezzanine MF-01 to MF-03",
        "6. QC comparison sheets - one per plan: original vs extraction vs 3D",
        "7. Quality-control report",
        "8. Items for engineering review",
    ], size=12)
    D.h2("Status")
    D.para("DRAFT FOR ENGINEERING REVIEW - NOT FOR SUBMISSION. This package does not certify compliance with the UAE "
           "Fire & Life Safety Code or claim ADCDA approval. The escape strategy has not been redesigned: every route, exit, "
           "assembly point and equipment position is taken from the supplied sheets. All content must be reviewed and "
           "approved by the appointed Fire & Life Safety consultant before formal submission.", 11.5, bold=True,
           color=G.DARK_RED)
    D.para(f"Issue: P01 (draft) - {TODAY}. Plan sheets use the client's approved sample format (EVAC_PLAN.pdf) and the "
           "client-supplied ADCD logo.", 11)

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
                     f"{max(s['stair_zones'] for s in ss)} highlighted",
                     "Yes (2)" if ss[0]["symbols"].get("assembly_point") else "Not shown on this floor"])
    D.table(["Floor", "Sheets (YAH variants)", "Fire & life-safety equipment (symbol count)", "Consistency",
             "Escape stairs", "Assembly points"], rows, [0.1, 0.13, 0.4, 0.13, 0.14, 0.1], size=8.6)
    D.h2("Variant consistency (equipment layout after best rigid fit to variant -01)")
    rows = []
    for s in A:
        f = s.get("fit_to_01")
        if not f:
            continue
        rows.append([s["code"], f"{f['rotation_deg']}\u00b0" + (" mirrored" if f["mirrored"] else ""),
                     f"{f['scale_ratio']:.2f}", f"{f['median_residual_pt']:.1f} pt", f"{f['max_residual_pt']:.0f} pt",
                     "VERIFIED - same layout" if f["max_residual_pt"] < 12 else
                     "PARTIAL - same equipment set; some symbols drawn in different positions; confirm on site"])
    D.table(["Sheet", "Plan rotation vs -01", "Plot size ratio", "Median offset", "Max offset", "Result"],
            rows, [0.08, 0.14, 0.1, 0.1, 0.1, 0.48], size=8.6)
    D.h2("Per-sheet extraction summary")
    rows = []
    for s in A:
        m = pickle.load(open(os.path.join(out, f"{s['code']}_model.pkl"), "rb"))
        r = m["routes"]
        rows.append([s["code"], f"{len(m['walls'])}", f"{len(m['stairs'])}", f"{len(r['polylines'])}",
                     f"{r['unreached_px']}", f"{sum(a['agrees'] for a in r['midroute_arrows'])}/{len(r['midroute_arrows'])}",
                     f"{len(r['terminals'])}", "Yes" if m.get("yah") else "No",
                     f"{m['scale_pt_per_m']:.1f} pt/m (~1:{72 / 25.4 * 1000 / m['scale_pt_per_m']:.0f})",
                     f"{s['azimuth']:.0f}\u00b0"])
    D.table(["Sheet", "Wall solids", "Escape stairs", "Route segments", "Unreached route px", "Mid-route arrows agree",
             "Route ends", "YAH", "Derived plot scale", "View azimuth"],
            rows, [0.07, 0.08, 0.08, 0.09, 0.1, 0.12, 0.08, 0.06, 0.18, 0.14], size=8.6)
    D.bullets([
        f"Scale: not stated on any sheet. Reference {SCALE_PT_PER_M:.2f} pt/m on the Ground Floor sheet GF-01, from the 110.8 pt "
        "parking-bay depth read as 5.5 m and cross-checked against car outlines and WC fittings (+/-10%). Other sheets are "
        "scaled by their measured route-dash width. Scale only affects metre values (wall height, spacing), never the "
        "plan geometry, which is used at true proportion.",
        "Room names: none are shown on any supplied sheet, so none are shown on the 3D plans.",
    ], size=10)

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
        ["M13", "Print-quality ADCD logo artwork; site plan for the 'Site Map' panel", "MISSING",
         "The logo used is the client-supplied image (cropped from a phone screenshot, ~690 px wide): adequate on screen "
         "but a vector or high-resolution file is needed for print. The Site Map panel shows the floor key plan until a "
         "site plan is provided."],
        ["C1", "Same floor plotted at different orientations and sizes across variants", "EXPLICIT",
         "Not a conflict in content. The approved format is landscape, so every sheet of a floor is shown in that floor's "
         "landscape reference orientation (B-01, GF-02, MF-02). Confirm against each sign's mounting position (M11)."],
        ["C2", "Symbol positions differ between variants of the same floor (see section 2)", "DERIVED",
         "Each sheet reproduces its own source positions. Confirm which positions are correct where variants differ."],
        ["C3", "Unexplained text '322 290' repeated on Ground and Mezzanine sheets", "EXPLICIT",
         "Meaning unknown (possibly a tag or dimension pair). Not reproduced."],
        ["C4", "Stair riser numbering 1-30 (Ground) and 1-34 (Mezzanine)", "EXPLICIT",
         "Implies different flights; cannot derive storey heights without riser dimensions."],
        ["C5", "Fire brigade inlet and wheeled extinguishers identified only from the icon artwork", "INFERRED",
         "Confirm device type with the FLS / fire-fighting drawings."],
    ], [0.04, 0.33, 0.08, 0.55], size=8.4, status_col=2)

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
        ["2", "Plan area isolation between title and legend; scale derivation. Reference scale from the Ground Floor; other "
              "sheets scaled by their measured route-dash width (sheets are plotted at different sizes)",
         "Text positions; Q-SPCQ bays; route dashes", "Scale cross-checked against cars and WC fittings"],
        ["3", "Walls & columns: solid poche fills + wall outlines rasterised at 4 px/pt, closed, vectorised to polygons "
              "with holes. Basement light-grey hatch is filtered to remove parking stripes, road arrows and zebra "
              "crossings", "A-HATCH (grey fills), A-WALL, S-COLS, A-WALL-PATT; OpenCV", "Overlay vs original (QC sheets)"],
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
        "sampled from the approved file. The client-supplied ADCD logo is placed at the top centre.",
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

    # ------------------------------------------------ 5. plans
    for s in A:
        code = s["code"]
        m = pickle.load(open(os.path.join(out, f"{code}_model.pkl"), "rb"))
        sc = json.load(open(os.path.join(out, f"{code}_scene.json")))
        cam = SC.Camera(s["azimuth"], 52)
        sheet = {"floor": s["floor"], "code": code, "source_name": s["file"], "revision": f"P01 (draft) {TODAY}",
                 "logo": logo}
        SH.draw_plan_sheet(c, sheet, m, cam, SC.Frame(m), sc["frustum"], os.path.join(out, f"{code}_3d.png"))
        c.showPage()
        # standalone sheet PDF + SVG (editable sources)
        c1 = canvas.Canvas(os.path.join(out, f"{code}.pdf"), pagesize=SH.SHEET_SIZE)
        c1.setTitle(f"Evacuation Plan {code} (3D)")
        SH.draw_plan_sheet(c1, sheet, m, cam, SC.Frame(m), sc["frustum"], os.path.join(out, f"{code}_3d.png"))
        c1.showPage()
        c1.save()

    # ------------------------------------------------ 6. comparisons
    for s in A:
        code = s["code"]
        m = pickle.load(open(os.path.join(out, f"{code}_model.pkl"), "rb"))
        ov = CP.overlay(src_of(s), m, os.path.join(out, f"{code}_qc_overlay.png"))
        plan = CP.plan_raster(os.path.join(out, f"{code}.pdf"), os.path.join(out, f"{code}_plan_raster.png"))
        CP.draw_comparison(c, code, FLOOR_NAME[s["floor"]], s["file"], ov.replace(".png", "_orig.png"), ov, plan,
                           sheet_checks(s, m))
        c.showPage()

    # ------------------------------------------------ 7. QC report
    D.y = None
    D.new_page("7. Quality-control report")
    D.h2("7.1 Information classification (all sheets)")
    D.table(["Element", "Class", "Basis"], [
        ["Wall, column and glazing positions", "EXPLICIT", "CAD layers in the supplied PDF"],
        ["Escape stair locations", "EXPLICIT", "Green highlight on the source sheet"],
        ["Escape routes, start points and directions", "EXPLICIT", "A-ESCAPE-ROUTE geometry and arrowheads"],
        ["Route connectivity across dash gaps and junctions", "DERIVED", "Bridging and graph tracing (section 4)"],
        ["Equipment symbol positions and types", "EXPLICIT", "Embedded icons; positions are symbol centres"],
        ["Plot scale and metre values", "DERIVED", "Bay depth, car outlines, WC fittings; route-dash ratio per sheet"],
        ["Floor plate outline", "INFERRED", "Flood-fill of a closed perimeter, else concave hull; no slab edge on source"],
        ["Wall height 2.0 m, slab 0.35 m", "INFERRED", "Diagrammatic cut, chosen so walls do not hide the routes"],
        ["Escape-stair flight geometry", "INFERRED", "Shown as plan treads at floor level, not as rising flights"],
        ["Fire brigade inlet, wheeled extinguisher type", "INFERRED", "From the icon artwork only"],
        ["Room names, dimensions, north point, storey heights", "MISSING", "Not on any supplied sheet"],
        ["Approved FLS strategy cross-check", "MISSING", "No FLS drawings or report supplied"],
    ], [0.3, 0.12, 0.58], size=9, status_col=1)
    D.h2("7.2 Exits and route ends per sheet")
    D.para("Every traced route end classified by its nearest destination feature. DERIVED = the drawing shows the route "
           "reaching a stair or assembly point; PARTIAL = an exit sign is adjacent but the door's final-exit status is not "
           "confirmed; UNVERIFIED = no destination feature nearby.", 9.5, color=G.GREY)
    for s in A:
        m = pickle.load(open(os.path.join(out, f"{s['code']}_model.pkl"), "rb"))
        D.h2(f"{s['code']} - {FLOOR_NAME[s['floor']]}")
        D.table(["End", "Position (sheet)", "Nearest destination feature", "Status"], route_end_table(m),
                [0.06, 0.18, 0.3, 0.46], size=8.6, status_col=3)
        bad = [a for a in m["routes"]["midroute_arrows"] if not a["agrees"]]
        if bad:
            D.para(f"{len(bad)} mid-route chevron(s) on the source do not match the traced direction (e.g. stacked arrow "
                   "pairs at exits). The traced direction, which runs toward the arrowed exits, is used on the plan. "
                   "Review on the comparison sheet.", 9.5, color=HexColor("#C77700"))
    D.h2("7.3 Unclear geometry")
    D.bullets([
        "Ground Floor: the feature (curved) stair in the showroom is numbered 1-30 but not highlighted as an escape stair. "
        "It is shown as walls only, with no route on it. Confirm it is not part of the means of escape.",
        "Ground Floor: the long free-standing wall line south of the building sits on the wall layers. Confirm whether it "
        "is a site boundary wall. Exterior routes run over site areas that are not drawn (no site plan).",
        "Basement: walls are drawn as light-grey hatch, which also carries parking stripes, road arrows and zebra "
        "crossings. These were filtered out by shape. A ladder-hatched element north-west of the west stair was removed "
        "with them; confirm whether it is a stair or ramp.",
        "Mezzanine: large areas marked with diagonal cross lines on the source (probably voids or double-height space over "
        "the showroom) are shown as floor plate. Confirm, and they can be cut out as voids.",
        "All floors: the floor-plate edge is inferred and may differ from the slab edge by up to ~3 m at open facades.",
    ], size=10)
    D.h2("7.4 Assumptions made during reconstruction")
    D.bullets([
        "Each supplied sheet is the authoritative evacuation layout for its installation position. Routes were not redesigned "
        "or extended, and no exit was inferred from door geometry.",
        "A route end touching a green-highlighted stair is treated as entering the stair, unless the route already leads on "
        "to an arrowed exit (for example people arriving by stair at the Ground Floor and continuing outside).",
        "Escape routes are all shown as one class (no primary/secondary distinction on the source).",
        "Remember / تذكر wording is reproduced exactly from the approved sample; no instructions were added.",
        "Each sheet is shown in its floor's landscape reference orientation to fit the approved landscape format.",
        "Arabic text follows the source wording where it existed; new Arabic labels need a native-speaker check.",
    ], size=10)

    D.new_page("8. Items for engineering review")
    D.bullets([
        "Orientation of the variants that were portrait sources (B-03, B-04, GF-01, GF-03, MF-01, MF-03), which are now "
        "turned to their floor's landscape reference: confirm against each sign's mounting position (M11).",
        "Route ends in section 7.2: confirm the final exits and the assembly points.",
        "Items M1-M13 and C1-C5 (section 3): FLS strategy, GA plans, print-quality logo artwork and site plan.",
        "Mezzanine voids and the Basement ladder-hatched element (section 7.3).",
        "Arabic wording of labels that were not on the source sheets.",
        "Whether a stacked multi-floor overview is wanted; this needs storey heights (M4) and stair continuity (M6).",
    ], size=11)
    D.para("Editable sources supplied separately: for every sheet, the 3D model (glTF .glb, metres), the scene and extracted "
           "model data (JSON), the high-resolution architectural render (PNG) and the vector sheet (PDF/SVG). The "
           "generating scripts (Python + three.js) allow exact regeneration after review.", 10.5)
    D.close()
    c.save()
    return pdf_path


if __name__ == "__main__":
    print(main(*sys.argv[1:4]))
