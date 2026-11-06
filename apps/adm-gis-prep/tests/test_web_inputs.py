"""The web form's code lists and ID patterns (apps/web/src/lib/bdms-inputs.ts) must match this manifest."""
from __future__ import annotations

import re
from pathlib import Path

from m4adm.rules import load_profile

WEB = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "bdms-inputs.ts"


def _ts_list(src: str, name: str) -> list[str]:
    body = re.search(rf"export const {name} = \[(.*?)\] as const;", src, re.S).group(1)
    return re.findall(r"'([^']*)'", body)


def test_web_code_lists_match_the_manifest():
    src = WEB.read_text(encoding="utf-8")
    domains = load_profile("bdms_building").domains
    assert _ts_list(src, "USAGE_CATEGORY_TYPES") == domains["usage_category_type"]
    assert _ts_list(src, "USAGE_TYPES") == domains["usage_type"]
    assert _ts_list(src, "DRAWING_TYPES") == domains["drawing_type"]


def test_web_id_patterns_match_the_manifest():
    src = WEB.read_text(encoding="utf-8")
    fn = load_profile("bdms_building").filename
    assert re.search(r"const FLOOR_ID = /(.*?)/;", src).group(1) == fn["floor_id_regex"]
    assert re.search(r"const POSITIVE_INT = /(.*?)/;", src).group(1) == fn["building_id_regex"]
