"""QC report rendering (the JSON report is written by the pipeline; this renders HTML)."""
from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

_ENV = Environment(
    loader=FileSystemLoader(Path(__file__).parent),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


def render_html(report: dict) -> str:
    return _ENV.get_template("report.html").render(r=report)
