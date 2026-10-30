"""Debug: draw the extracted model in plan to verify against the source."""
import sys, pickle, time
import cv2, numpy as np
import model as M

t = time.time()
m = M.build(sys.argv[1])
print("built in", round(time.time() - t, 1), "s")
pickle.dump(m, open(sys.argv[2] + ".pkl", "wb"))
bb = m["bbox"]; s = 2.0
img = np.full((int((bb[3] - bb[1]) * s), int((bb[2] - bb[0]) * s), 3), 255, np.uint8)
P = lambda p: np.round((np.asarray(p) - [bb[0], bb[1]]) * s).astype(np.int32)
for p in m["slab"]: cv2.fillPoly(img, [P(p["outer"])], (242, 242, 242))
for p in m["stairs"]: cv2.fillPoly(img, [P(p["outer"])], (150, 255, 150))
for k, segs in m["floor_lines"].items():
    for sg in segs: cv2.polylines(img, [P(sg)], False, (200, 200, 200), 1)
for p in m["glazing"]: cv2.fillPoly(img, [P(p["outer"])], (230, 200, 150))
for p in m["walls"]:
    cv2.fillPoly(img, [P(p["outer"])] + [P(h) for h in p["holes"]], (110, 110, 110))
r = m["routes"]
for pl in r["polylines"]:
    cv2.polylines(img, [P(pl)], False, (0, 170, 0), 2)
    a, b = P(pl[-2]), P(pl[-1]); cv2.arrowedLine(img, tuple(map(int, a)), tuple(map(int, b)), (0, 90, 0), 2, tipLength=min(1.0, 14 / max(1, np.hypot(*(b - a)))))
for d in r["dots"]: cv2.circle(img, tuple(map(int, P(d))), 6, (0, 120, 0), -1)
for t in r["terminals"]: cv2.circle(img, tuple(map(int, P(t))), 8, (0, 0, 0), 2)
for a in r["midroute_arrows"]:
    c = P(a["pos"]); e = c + np.asarray(a["dir"]) * 25
    cv2.arrowedLine(img, tuple(map(int, c)), tuple(map(int, e)), (0, 160, 0) if a["agrees"] else (0, 0, 255), 3, tipLength=0.5)
print("midroute", [(a["agrees"]) for a in r["midroute_arrows"]])
col = dict(fire_extinguisher=(0,0,255), wheeled_extinguisher=(0,0,160), fire_hose_reel=(0,100,255), manual_call_point=(180,0,255),
           lift=(0,0,0), exit_sign=(0,140,0), assembly_point=(0,90,0), fire_brigade_inlet=(0,0,100))
for sy in m["symbols"]:
    c = tuple(map(int, P(sy["pos"]))); cv2.circle(img, c, 7, col[sy["kind"]], -1)
    cv2.putText(img, sy["kind"][:6], (c[0] + 8, c[1] + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, col[sy["kind"]], 1)
if m["yah"]:
    cv2.circle(img, tuple(map(int, P(m["yah"]["tip"]))), 10, (0, 0, 255), 3)
    cv2.line(img, tuple(map(int, P(m["yah"]["head"]))), tuple(map(int, P(m["yah"]["tip"]))), (0, 0, 255), 2)
cv2.imwrite(sys.argv[2] + ".png", img)
print("walls", len(m["walls"]), "glazing", len(m["glazing"]), "stairs", len(m["stairs"]), "routes", len(r["polylines"]),
      "unreached_px", r["unreached_px"], "dots", len(r["dots"]), "arrows", r["arrow_count"], "symbols", len(m["symbols"]), "yah", m["yah"])
