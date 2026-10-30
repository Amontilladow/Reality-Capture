"""Text/table pages of the package (A3 landscape) with simple flowing layout."""
from reportlab.lib.colors import HexColor

import graphics as G

A3L = (1191, 842)
M = 40


class Doc:
    def __init__(self, c, footer):
        self.c = c
        self.footer = footer
        self.page_no = 0
        self.y = None

    # ---- page furniture
    def new_page(self, title=None):
        if self.y is not None:
            self._finish()
        self.c.setPageSize(A3L)
        self.page_no += 1
        W, H = A3L
        self.c.setFillColor(G.GREEN)
        self.c.rect(0, H - 10, W, 10, stroke=0, fill=1)
        self.y = H - M - 10
        if title:
            self.h1(title)

    def _finish(self):
        W, H = A3L
        c = self.c
        c.setStrokeColor(HexColor("#CCCCCC"))
        c.line(M, M - 4, W - M, M - 4)
        G.text_en(c, M, M - 20, self.footer, 8.5, color=G.GREY)
        G.text_en(c, W - M, M - 20, f"Page {self.page_no}", 8.5, color=G.GREY, align="right")
        c.showPage()

    def close(self):
        self._finish()
        self.y = None

    def need(self, h, title=None):
        if self.y - h < M + 10:
            self.new_page(title)

    # ---- blocks
    def h1(self, t):
        self.need(60)
        G.text_en(self.c, M, self.y - 28, t, 24, bold=True)
        self.c.setFillColor(G.GREEN)
        self.c.rect(M, self.y - 40, 80, 4, stroke=0, fill=1)
        self.y -= 58

    def h2(self, t):
        self.need(40)
        G.text_en(self.c, M, self.y - 16, t, 14, bold=True, color=G.DARK_GREEN)
        self.y -= 26

    def para(self, t, size=10.5, color=G.BLACK, bold=False, indent=0, width=None):
        width = width or (A3L[0] - 2 * M - indent)
        for line in _wrap(self.c, t, "Sans-B" if bold else "Sans", size, width):
            self.need(size * 1.4)
            G.text_en(self.c, M + indent, self.y - size, line, size, bold=bold, color=color)
            self.y -= size * 1.4
        self.y -= size * 0.5

    def bullets(self, items, size=10.5):
        for it in items:
            lines = _wrap(self.c, it, "Sans", size, A3L[0] - 2 * M - 18)
            self.need(size * 1.4 * len(lines))
            self.c.setFillColor(G.GREEN)
            self.c.circle(M + 5, self.y - size * 0.65, 2.4, stroke=0, fill=1)
            for line in lines:
                G.text_en(self.c, M + 16, self.y - size, line, size)
                self.y -= size * 1.4
            self.y -= 2
        self.y -= size * 0.4

    def table(self, header, rows, widths, size=8.6, head_fill="#E8F6EE", status_col=None):
        c = self.c
        tw = A3L[0] - 2 * M
        ws = [tw * w for w in widths]

        def draw_header():
            hh = max(len(_wrap(c, h, "Sans-B", size, w - 8)) for h, w in zip(header, ws)) * size * 1.25 + 8
            c.setFillColor(HexColor(head_fill))
            c.rect(M, self.y - hh, tw, hh, stroke=0, fill=1)
            x = M
            for h, w in zip(header, ws):
                yy = self.y - size - 4
                for line in _wrap(c, h, "Sans-B", size, w - 8):
                    G.text_en(c, x + 4, yy, line, size, bold=True)
                    yy -= size * 1.25
                x += w
            self.y -= hh

        self.need(60)
        draw_header()
        for row in rows:
            wrapped = [_wrap(c, str(v), "Sans", size, w - 8) for v, w in zip(row, ws)]
            rh = max(len(wl) for wl in wrapped) * size * 1.25 + 7
            if self.y - rh < M + 10:
                self.new_page()
                draw_header()
            x = M
            for j, (wl, w) in enumerate(zip(wrapped, ws)):
                yy = self.y - size - 3
                colr = G.BLACK
                if status_col is not None and j == status_col:
                    colr = _status_colour(row[j])
                for line in wl:
                    G.text_en(c, x + 4, yy, line, size, bold=(j == 0 or j == status_col), color=colr)
                    yy -= size * 1.25
                x += w
            self.y -= rh
            c.setStrokeColor(HexColor("#DDDDDD"))
            c.setLineWidth(0.6)
            c.line(M, self.y, M + tw, self.y)
        self.y -= 12


def _status_colour(v):
    v = str(v).upper()
    if v.startswith("EXPLICIT") or v.startswith("VERIFIED"):
        return G.SIGN_GREEN
    if v.startswith("DERIVED"):
        return HexColor("#1F6FB2")
    if v.startswith("INFERRED") or v.startswith("PARTIAL"):
        return HexColor("#C77700")
    if v.startswith("MISSING") or v.startswith("NOT") or v.startswith("UNVERIFIED"):
        return G.DARK_RED
    return G.BLACK


def _wrap(c, text, font, size, width):
    out = []
    for para in str(text).split("\n"):
        line = ""
        words = []
        for w in para.split():
            # hard-split tokens wider than the cell (file names have no spaces)
            while c.stringWidth(w, font, size) > width and len(w) > 1:
                k = len(w)
                while k > 1 and c.stringWidth(w[:k], font, size) > width:
                    k -= 1
                words.append(w[:k])
                w = w[k:]
            words.append(w)
        for w in words:
            t = (line + " " + w).strip()
            if c.stringWidth(t, font, size) > width and line:
                out.append(line)
                line = w
            else:
                line = t
        out.append(line)
    return out or [""]
