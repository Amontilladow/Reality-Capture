"""Stage J: conversion report (JSON + HTML) and an SVG preview of every generated feature."""
from __future__ import annotations

import html
from collections import Counter

from m4adm.convert.features import Feature
from m4adm.convert.rooms import HIGH, NOT_GENERATED, REVIEW, UNRESOLVED, Detection, polygons

STATUS_COLOR = {HIGH: "#1a8f3a", REVIEW: "#e08600", UNRESOLVED: "#c62828", NOT_GENERATED: "#bdbdbd",
                "USER_ACCEPTED": "#1565c0", "USER_REJECTED": "#757575"}


def preview_svg(det: Detection, feats: list[Feature], width: int = 1600) -> str:
    geoms = [f.poly for f in feats if f.poly is not None]
    if det.envelope is not None:
        geoms.append(det.envelope)
    if not geoms:
        return '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60"><text x="10" y="30">' \
               'Nothing was generated.</text></svg>'
    x0 = min(g.bounds[0] for g in geoms) - 1
    y0 = min(g.bounds[1] for g in geoms) - 1
    x1 = max(g.bounds[2] for g in geoms) + 1
    y1 = max(g.bounds[3] for g in geoms) + 1
    sc = width / (x1 - x0)
    h = int((y1 - y0) * sc) + 1

    def pts(coords) -> str:
        return " ".join(f"{(x - x0) * sc:.1f},{(y1 - y) * sc:.1f}" for x, y in coords)

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {h}" width="{width}" height="{h}" '
           'font-family="sans-serif" font-size="11">', '<rect width="100%" height="100%" fill="#fff"/>']
    for g in polygons(det.barrier):
        if g.intersects(det.envelope or g):
            for ring in [g.exterior, *g.interiors]:
                out.append(f'<polyline fill="none" stroke="#cfcfcf" stroke-width="1" points="{pts(ring.coords)}"/>')
    order = {NOT_GENERATED: 0, "USER_REJECTED": 0, UNRESOLVED: 1, REVIEW: 2, HIGH: 3, "USER_ACCEPTED": 3}
    for f in sorted(feats, key=lambda f: order.get(f.status, 0)):
        if f.poly is None or f.layer in ("Floor", "BuildingOutline", "Unit"):
            continue
        col = STATUS_COLOR.get(f.status, "#000")
        fill = col if f.layer in ("Door", "Window") else "none"
        out.append(f'<polygon fill="{fill}" fill-opacity="0.35" stroke="{col}" stroke-width="2" '
                   f'points="{pts(f.poly.exterior.coords)}"><title>{html.escape(f.id)}: '
                   f'{html.escape(f.status)}</title></polygon>')
        if f.layer == "Space" and f.status != NOT_GENERATED:
            c = f.poly.representative_point()
            name = f.attributes.get("SPACEUSAGE")
            label = f"{f.id.removeprefix('SPACE_')} {name.value if name else ''}"
            out.append(f'<text x="{(c.x - x0) * sc:.1f}" y="{(y1 - c.y) * sc:.1f}" fill="#222">'
                       f'{html.escape(label)}</text>')
    if det.envelope is not None:
        out.append(f'<polygon fill="none" stroke="#000" stroke-width="1.5" points="{pts(det.envelope.exterior.coords)}"/>')
    for c in det.closures:
        out.append(f'<polyline fill="none" stroke="#d32f2f" stroke-dasharray="4 3" stroke-width="2" '
                   f'points="{pts([c.a, c.b])}"/>')
    legend = [(HIGH, "auto-generated, high confidence"), (REVIEW, "generated, requires review"),
              (NOT_GENERATED, "not generated (sliver / cavity)")]
    for i, (st, text) in enumerate(legend):
        out.append(f'<rect x="10" y="{10 + 18 * i}" width="12" height="12" fill="{STATUS_COLOR[st]}"/>'
                   f'<text x="28" y="{20 + 18 * i}">{html.escape(text)}</text>')
    out.append(f'<line x1="10" y1="{70}" x2="22" y2="{70}" stroke="#d32f2f" stroke-dasharray="4 3" stroke-width="2"/>'
               f'<text x="28" y="74">doorway closure (virtual, not written)</text>')
    out.append("</svg>")
    return "\n".join(out)


def summary(feats: list[Feature]) -> dict:
    by_layer: dict[str, Counter] = {}
    for f in feats:
        by_layer.setdefault(f.layer, Counter())[f.status] += 1
    attrs = Counter(v.provenance for f in feats if f.exported for v in f.attributes.values())
    return {"by_layer": {k: dict(v) for k, v in by_layer.items()}, "attribute_provenance": dict(attrs)}


def render_html(report: dict, svg: str) -> str:
    e = html.escape
    rows = []
    for f in report["features"]:
        if f["status"] == NOT_GENERATED and f["layer"] == "Space":
            continue
        attrs = "; ".join(f"{k}={v['value'] or '—'} ({v['provenance']})" for k, v in f["attributes"].items())
        rows.append(f"<tr><td>{e(f['id'])}</td><td>{e(f['layer'])}</td>"
                    f"<td style='color:{STATUS_COLOR.get(f['status'], '#000')}'>{e(f['status'])}</td>"
                    f"<td>{e(' | '.join(f['reasons']))}</td><td>{e(attrs)}</td></tr>")
    stages = "".join(f"<tr><td>{e(k)}</td><td>{e(str(v))}</td></tr>" for k, v in report["result"].items())
    missing = "".join(f"<li>{e(m['feature'])}: {e(m['tag'])} {e(m['note'])}</li>" for m in report["missing_mandatory"])
    geo = report["georeferencing"]
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Conversion report {e(report['job_id'])}</title>
<style>body{{font-family:sans-serif;margin:24px;color:#222}}table{{border-collapse:collapse;font-size:13px}}
td,th{{border:1px solid #ddd;padding:4px 6px;vertical-align:top}}.banner{{background:#fff3e0;border:1px solid #e08600;
padding:10px;margin-bottom:16px}}svg{{max-width:100%;height:auto;border:1px solid #ddd}}</style></head><body>
<div class="banner"><b>{e(report['label'])}</b><br>{e(report['status'])}</div>
<h1>CAD-to-GIS conversion</h1><p>Source: {e(report['source']['name'])} (SHA-256 {e(report['source']['sha256'][:16])}…,
unchanged: {e(str(report['source']['unchanged']))}). Target: {e(report['target_schema'])}.</p>
<h2>Result</h2><table>{stages}</table>
<h2>Preview (local metres)</h2>{svg}
<h2>Georeferencing: {e(geo['status'])}</h2><ul>{''.join(f'<li>{e(m)}</li>' for m in geo['messages'])}</ul>
<h2>Mandatory attributes still missing ({len(report['missing_mandatory'])})</h2><ul>{missing}</ul>
<h2>Features</h2><table><tr><th>Id</th><th>Layer</th><th>Status</th><th>Reasons</th><th>Attributes</th></tr>
{''.join(rows)}</table>
<h2>Limitations</h2><ul>{''.join(f'<li>{e(x)}</li>' for x in report['limitations'])}</ul>
</body></html>"""
