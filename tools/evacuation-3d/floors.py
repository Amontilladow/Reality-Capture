"""Floor identification and naming, from the sheet's own title text.

The floor key is the title without " FLOOR" ("GROUND FLOOR" -> "GROUND"), so any
floor name works; common floors also get their Arabic name and a short sheet
code prefix. An unknown floor keeps its English title and an empty Arabic name,
which the conversion report flags for a native-speaker check.
"""
import re

import pymupdf

KNOWN = {  # key: (sheet-code prefix, Arabic name, vertical order)
    "BASEMENT": ("B", "الطابق السفلي", -1),
    "LOWER GROUND": ("LG", "الطابق الأرضي السفلي", -0.5),
    "GROUND": ("GF", "الطابق الأرضي", 0),
    "MEZZANINE": ("MF", "طابق الميزانين", 0.5),
    "PODIUM": ("P", "طابق المنصة", 0.7),
    "FIRST": ("F1", "الطابق الأول", 1),
    "SECOND": ("F2", "الطابق الثاني", 2),
    "THIRD": ("F3", "الطابق الثالث", 3),
    "FOURTH": ("F4", "الطابق الرابع", 4),
    "FIFTH": ("F5", "الطابق الخامس", 5),
    "SIXTH": ("F6", "الطابق السادس", 6),
    "SEVENTH": ("F7", "الطابق السابع", 7),
    "EIGHTH": ("F8", "الطابق الثامن", 8),
    "NINTH": ("F9", "الطابق التاسع", 9),
    "TENTH": ("F10", "الطابق العاشر", 10),
    "TYPICAL": ("TF", "الطابق المتكرر", 50),
    "ROOF": ("RF", "طابق السطح", 100),
}
# spelling variants seen on drawings
ALIASES = {"BASMENT": "BASEMENT", "MEZZ": "MEZZANINE", "MEZZANINE FLOOR": "MEZZANINE", "GROUND FLOOR": "GROUND",
           "ROOF TOP": "ROOF", "ROOFTOP": "ROOF"}


def normalise(title):
    t = re.sub(r"\s+", " ", title.upper()).strip()
    t = re.sub(r"\s+(FLOOR|LEVEL)$", "", t)
    return ALIASES.get(t, t)


def from_texts(texts):
    """Floor key from a sheet's text spans: the span naming a floor, not the plan title."""
    for t in texts:
        u = t.strip().upper()
        if u and "EVACUATION" not in u and re.search(r"\b(FLOOR|LEVEL|BASEMENT|ROOF|MEZZANINE)\b", u):
            return normalise(u)
    return None


def from_filename(name):
    m = re.search(r"(Basment|Basement|Ground_Floor|Mezzanine_Floor|Roof_Floor|[A-Za-z]+_Floor)", name)
    return normalise(m.group(1).replace("_", " ")) if m else None


def identify(path):
    """(floor key, landscape?) read from the PDF itself, falling back to the filename."""
    doc = pymupdf.open(path)
    page = doc[0]
    texts = [s["text"] for b in page.get_text("dict")["blocks"] for line in b.get("lines", []) for s in line["spans"]]
    key = from_texts(texts) or from_filename(path.rsplit("/", 1)[-1]) or "FLOOR"
    return key, page.rect.width > page.rect.height


def names(key):
    """(English title, Arabic title); Arabic is '' for a floor not in KNOWN."""
    en = f"{key} FLOOR" if key != "FLOOR" else "FLOOR"
    return en, KNOWN.get(key, ("", "", 0))[1]


def title_case(key):
    return names(key)[0].title()


def prefix(key):
    if key in KNOWN:
        return KNOWN[key][0]
    letters = "".join(w[0] for w in key.split() if w)
    return (letters or "FL")[:3]


def rank(key):
    return KNOWN.get(key, ("", "", 60))[2]
