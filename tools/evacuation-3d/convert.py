"""Batch conversion runner: a folder of 2D evacuation-plan PDFs -> 3D plan package.

Used by apps/evac3d-service (the "Convert" button) and from the command line.

    python3 convert.py run <job_dir>

<job_dir>/input/*.pdf        the 2D sheets (any file names; floors are read from each sheet's title)
<job_dir>/input/logo.*       optional logo (PNG/JPG), placed at the top centre of every sheet
<job_dir>/settings.json      optional {"revision": "...", "notes": ["project review note", ...]}

Writes <job_dir>/progress.json while running and <job_dir>/result/ when done:
    evacuation_plans.pdf      combined package (register, plans, QC comparisons, QC report)
    sheets/<code>.pdf|.svg    each plan sheet on its own
    previews/<code>.png       small preview of each plan sheet
    models/<code>.glb         editable 3D model of each floor plate
    report.json               per-sheet results and review flags

Each sheet's model build and 3D render run in their own process so memory is
returned between sheets (one model build peaks at ~1.5 GB on large sheets).
Exit codes: 0 done, 2 the input was rejected (nothing convertible), 1 failure.
"""
import datetime
import glob
import json
import os
import pickle
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BASE_AZ = 18.0
ELEVATION = 52.0


class Rejected(Exception):
    pass


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


class Progress:
    def __init__(self, job_dir):
        self.path = os.path.join(job_dir, "progress.json")
        self.state = {"stage": "starting", "total": 0, "done": 0, "current": None, "sheets": [],
                      "started": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        self.save()

    def update(self, **kw):
        self.state.update(kw)
        self.save()

    def save(self):
        _write_json(self.path, self.state)


# ---------------------------------------------------------------- stage 0 --

def identify_sheets(pdfs):
    """Floor + sheet code for every PDF, from the sheet's own title text."""
    import floors
    found = []
    for p in sorted(pdfs):
        key, landscape = floors.identify(p)
        m = re.search(r"(\d+)(?:_\d+)?\.pdf$", os.path.basename(p), re.I)
        found.append({"path": p, "floor": key, "landscape": landscape, "num": int(m.group(1)) if m else None})
    sheets, used = [], set()
    for key in dict.fromkeys(s["floor"] for s in found):
        group = [s for s in found if s["floor"] == key]
        nums = [s["num"] for s in group]
        if None in nums or len(set(nums)) != len(nums):
            nums = list(range(1, len(group) + 1))   # file names carry no usable sheet number
        for s, n in sorted(zip(group, nums), key=lambda t: t[1]):
            code = f"{floors.prefix(key)}-{n:02d}"
            while code in used:
                n += 1
                code = f"{floors.prefix(key)}-{n:02d}"
            used.add(code)
            sheets.append({**s, "code": code})
    return sheets


# ---------------------------------------------------------------- stage 1 --

def build_model(pdf, out, code, floor):
    """One sheet: extraction + model + register summary (run in a subprocess)."""
    import analyze_all as AA
    import model as MD
    s, m = AA.summarise(pdf, code=code, floor=floor)
    s["source_path"] = os.path.abspath(pdf)
    stem = os.path.join(out, code)
    with open(stem + "_model.pkl", "wb") as f:
        pickle.dump(m, f)
    MD.save(m, stem + "_model.json")
    s["symbol_positions"] = [{"kind": x["kind"], "pos": [float(v) for v in x["pos"]]} for x in m["symbols"]]
    _write_json(stem + "_summary.json", s)


# ---------------------------------------------------------------- stage 2 --

def choose_views(sheets, out):
    """Landscape reference orientation per floor (a floor with no landscape sheet
    is turned 90 degrees) and each sheet's azimuth, from the rigid fit of its
    equipment symbols to the floor's first sheet."""
    import analyze_all as AA
    summaries = {s["code"]: json.load(open(os.path.join(out, s["code"] + "_summary.json")))
                 for s in sheets if os.path.exists(os.path.join(out, s["code"] + "_summary.json"))}
    for key in dict.fromkeys(s["floor"] for s in sheets):
        group = [s for s in sheets if s["floor"] == key and s["code"] in summaries]
        if not group:
            continue
        first = summaries[group[0]["code"]]
        rot = {}
        for s in group:
            sm = summaries[s["code"]]
            fit = None
            if s is not group[0] and sm["symbol_positions"] and first["symbol_positions"]:
                fit = AA.fit_variant({"symbols": first["symbol_positions"]}, {"symbols": sm["symbol_positions"]})
                sm["fit_to_01"] = fit
            rot[s["code"]] = fit["rotation_deg"] if fit else 0
        land = [s for s in group if s["landscape"]]
        ref, turn = (land[0], 0) if land else (group[0], 90)
        for s in group:
            sm = summaries[s["code"]]
            sm["azimuth"] = (BASE_AZ + turn + rot[s["code"]] - rot[ref["code"]]) % 360
            _write_json(os.path.join(out, s["code"] + "_summary.json"), sm)
    return summaries


# ---------------------------------------------------------------- stage 3 --

def render_sheet(out, code):
    """Scene + tiled 3D render + glTF export for one sheet (run in a subprocess)."""
    import scene as SC
    s = json.load(open(os.path.join(out, code + "_summary.json")))
    m = pickle.load(open(os.path.join(out, code + "_model.pkl"), "rb"))
    cam = SC.Camera(s["azimuth"], ELEVATION)
    sc, _ = SC.build_scene(m, cam, max_px=int(os.environ.get("EVAC3D_RENDER_PX", "8000")))
    SC.save(sc, os.path.join(out, code + "_scene.json"))
    subprocess.run(["node", os.path.join(HERE, "render", "render.js"), os.path.join(out, code + "_scene.json"),
                    os.path.join(out, code + "_3d.png")], check=True, stdout=subprocess.DEVNULL)


# ---------------------------------------------------------------- stage 4 --

def prepare_logo(src, dst):
    """Logo as PNG; a white background becomes transparent so it sits on the sheet colour."""
    import cv2
    import numpy as np
    im = cv2.imread(src, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise Rejected("The logo file could not be read (use PNG or JPG).")
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
    if im.shape[2] == 3:
        border = np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]])
        if border.min() > 215:   # white background
            d = 255 - im.min(2).astype(float)
            a = np.clip((d - 18) * 255 / 60, 0, 255).astype(np.uint8)
            im = np.dstack([im, a])
    cv2.imwrite(dst, im)
    return dst


SHEET_FLAGS = [
    ("route_polylines", lambda s: s["route_polylines"] == 0, "No escape route was found on this sheet."),
    ("route_unreached_px", lambda s: s["route_unreached_px"] > 0,
     "Part of the route linework could not be connected to an exit."),
    ("yah", lambda s: not s["yah"], "No YOU ARE HERE marker was found."),
    ("stair_zones", lambda s: s["stair_zones"] == 0, "No green-highlighted escape stair was found."),
    ("midroute", lambda s: any(a is False for a in s["midroute_arrows_agree"]),
     "A direction arrow on the source disagrees with the traced route direction."),
    ("symbols", lambda s: not s["symbols"], "No fire-safety symbols were recognised."),
]


def sheet_report(s, siblings):
    import floors
    flags = [msg for _, test, msg in SHEET_FLAGS if test(s)]
    if not floors.names(s["floor"])[1]:
        flags.append(f"Floor name '{s['floor']}' has no stored Arabic name; the Arabic floor title is left blank.")
    if any(o["symbols"] != s["symbols"] for o in siblings):
        flags.append("Equipment counts differ from other sheets of the same floor.")
    if s.get("fit_to_01") and s["fit_to_01"]["max_residual_pt"] >= 12:
        flags.append("Some symbols are drawn in different positions than on the floor's first sheet.")
    agree = [a for a in s["midroute_arrows_agree"]]
    return {
        "code": s["code"], "floor": s["floor"], "floorName": floors.title_case(s["floor"]), "file": s["file"],
        "symbols": s["symbols"], "routeSegments": s["route_polylines"], "unreachedPx": s["route_unreached_px"],
        "arrowsAgree": sum(1 for a in agree if a), "arrowsTotal": len(agree), "stairs": s["stair_zones"],
        "youAreHere": bool(s["yah"]), "azimuth": s.get("azimuth"), "flags": flags,
    }


def run(job_dir):
    job_dir = os.path.abspath(job_dir)
    inp, out, res = (os.path.join(job_dir, d) for d in ("input", "work", "result"))
    os.makedirs(out, exist_ok=True)
    settings = json.load(open(os.path.join(job_dir, "settings.json"))) if os.path.exists(
        os.path.join(job_dir, "settings.json")) else {}
    prog = Progress(job_dir)
    pdfs = sorted(glob.glob(os.path.join(inp, "*.pdf")) + glob.glob(os.path.join(inp, "*.PDF")))
    if not pdfs:
        raise Rejected("No PDF drawings were uploaded.")

    prog.update(stage="identifying")
    sheets = identify_sheets(pdfs)
    prog.update(stage="building", total=len(sheets) * 2 + 1,
                sheets=[{"code": s["code"], "floor": s["floor"], "file": os.path.basename(s["path"]),
                         "status": "queued"} for s in sheets])

    def sheet_status(code, status, error=None):
        for x in prog.state["sheets"]:
            if x["code"] == code:
                x["status"] = status
                if error:
                    x["error"] = error
        prog.save()

    def sub(args, code):
        r = subprocess.run([sys.executable, os.path.abspath(__file__)] + args, cwd=HERE,
                           capture_output=True, text=True)
        if r.returncode != 0:
            msg = (r.stderr or r.stdout).strip().splitlines()
            raise RuntimeError(msg[-1] if msg else f"exit code {r.returncode}")

    ok = []
    for s in sheets:
        prog.update(current=s["code"])
        sheet_status(s["code"], "modelling")
        try:
            sub(["_model", s["path"], out, s["code"], s["floor"]], s["code"])
            ok.append(s)
        except Exception as e:   # one unreadable sheet must not stop the batch
            sheet_status(s["code"], "failed", f"Model build failed: {e}")
        prog.update(done=prog.state["done"] + 1)
    if not ok:
        raise Rejected("None of the uploaded PDFs could be read as an evacuation plan "
                       "(see the per-sheet messages).")

    prog.update(stage="choosing views")
    summaries = choose_views(ok, out)

    rendered = []
    prog.update(stage="rendering")
    for s in ok:
        prog.update(current=s["code"])
        sheet_status(s["code"], "rendering")
        try:
            sub(["_render", out, s["code"]], s["code"])
            rendered.append(s)
            sheet_status(s["code"], "done")
        except Exception as e:
            sheet_status(s["code"], "failed", f"3D render failed: {e}")
            os.remove(os.path.join(out, s["code"] + "_summary.json"))
        prog.update(done=prog.state["done"] + 1)
    if not rendered:
        raise RuntimeError("No sheet could be rendered.")

    prog.update(stage="assembling", current=None)
    import make_package as MP
    import pymupdf
    logo = None
    for cand in glob.glob(os.path.join(inp, "logo.*")):
        logo = prepare_logo(cand, os.path.join(out, "logo_rgba.png"))
    codes = [s["code"] for s in rendered]
    pkg = MP.main(inp, out, logo, codes=codes, notes=settings.get("notes"))

    os.makedirs(os.path.join(res, "sheets"), exist_ok=True)
    os.makedirs(os.path.join(res, "previews"), exist_ok=True)
    os.makedirs(os.path.join(res, "models"), exist_ok=True)
    shutil.copy(pkg, os.path.join(res, "evacuation_plans.pdf"))
    for code in codes:
        sheet_pdf = os.path.join(out, code + ".pdf")
        shutil.copy(sheet_pdf, os.path.join(res, "sheets", code + ".pdf"))
        page = pymupdf.open(sheet_pdf)[0]
        with open(os.path.join(res, "sheets", code + ".svg"), "w") as f:
            f.write(page.get_svg_image(text_as_path=False))
        page.get_pixmap(dpi=72).save(os.path.join(res, "previews", code + ".png"))
        glb = os.path.join(out, code + "_3d.glb")
        if os.path.exists(glb):
            shutil.copy(glb, os.path.join(res, "models", code + ".glb"))

    final = [json.load(open(os.path.join(out, c + "_summary.json"))) for c in codes]
    sheet_reports = [sheet_report(s, [o for o in final if o["floor"] == s["floor"] and o is not s]) for s in final]
    failed = [x for x in prog.state["sheets"] if x["status"] == "failed"]
    flagged = sum(1 for r in sheet_reports if r["flags"]) + len(failed)
    report = {
        "kind": "evacuation-plans",
        "status": "READY_FOR_REVIEW" if not flagged else "NEEDS_ATTENTION",
        "statusLabel": ("All sheets converted with no automatic flags - ready for engineering review"
                        if not flagged else f"{flagged} sheet(s) need attention before review"),
        "draft": True,
        "sheets": sheet_reports,
        "failedSheets": [{"code": x["code"], "file": x["file"], "error": x.get("error", "")} for x in failed],
        "floors": list(dict.fromkeys(r["floorName"] for r in sheet_reports)),
        "logoSupplied": bool(logo),
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    _write_json(os.path.join(res, "report.json"), report)
    prog.update(stage="done", done=prog.state["total"])
    return report


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if cmd == "run":
            t = time.time()
            rep = run(sys.argv[2])
            print(json.dumps({"status": rep["status"], "sheets": len(rep["sheets"]), "seconds": round(time.time() - t)}))
        elif cmd == "_model":
            build_model(*sys.argv[2:6])
        elif cmd == "_render":
            render_sheet(*sys.argv[2:4])
        else:
            print(__doc__)
            sys.exit(1)
    except Rejected as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)
