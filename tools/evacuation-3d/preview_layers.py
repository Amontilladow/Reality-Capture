"""Debug helper: rasterise chosen layers in distinct colours."""
import pickle, sys
import cv2, numpy as np

def render(data, spec, out, scale=1.5, crop=None):
    W, H = data["size"]
    x0, y0, x1, y1 = crop or (0, 0, W, H)
    img = np.full((int((y1 - y0) * scale), int((x1 - x0) * scale), 3), 255, np.uint8)
    for lay, col in spec:
        for e in data["layers"].get(lay, []):
            p = ((e["pts"] - [x0, y0]) * scale).astype(np.int32)
            if e["fill"] and e["closed"]:
                cv2.fillPoly(img, [p], col)
            cv2.polylines(img, [p], False, col, 1, cv2.LINE_AA)
    cv2.imwrite(out, img)

if __name__ == "__main__":
    d = pickle.load(open(sys.argv[1], "rb"))
    groups = sys.argv[3].split(";")
    pal = [(0,0,0),(0,0,255),(255,0,0),(0,160,0),(200,0,200),(0,140,255),(160,160,0),(120,60,0)]
    spec = [(l, pal[i % len(pal)]) for i, g in enumerate(groups) for l in g.split(",")]
    crop = tuple(map(float, sys.argv[4].split(","))) if len(sys.argv) > 4 else None
    render(d, spec, sys.argv[2], crop=crop, scale=float(sys.argv[5]) if len(sys.argv) > 5 else 1.5)
