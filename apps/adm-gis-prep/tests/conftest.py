"""Shared test helpers. All drawings used in tests are SYNTHETIC, NOT AN OFFICIAL ADM SAMPLE."""
from __future__ import annotations

import uuid
from collections import Counter
from pathlib import Path

import pytest
from ezdxf.document import Drawing

from m4adm.fixtures import finish
from m4adm.models import JobSettings
from m4adm.pipeline import JobResult, prepare
from m4adm.rules import load_manifest


@pytest.fixture(scope="session")
def manifest():
    return load_manifest()


def make_settings(categories=("plot",), **overrides) -> JobSettings:
    base = dict(
        categories=list(categories),
        metadata={"project_id": "P101", "submission_date": "20261025", "drawing_type": "AP",
                  "consultant_name": "Synthetic Consultant", "contractor_name": "M4 Contracting"},
        crs={"source_crs": "EPSG:32640", "source_confirmed": True},
        units_confirmed_metres=True,
    )
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = {**base[key], **value}
        else:
            base[key] = value
    return JobSettings(**base)


@pytest.fixture
def save(tmp_path):
    def _save(doc: Drawing, name: str | None = None) -> Path:
        path = tmp_path / (name or f"SYNTHETIC_{uuid.uuid4().hex[:6]}.dxf")
        finish(doc).saveas(str(path))
        return path
    return _save


@pytest.fixture
def run(tmp_path, manifest, save):
    def _run(doc_or_path, categories=("plot",), **overrides) -> JobResult:
        path = doc_or_path if isinstance(doc_or_path, Path) else save(doc_or_path)
        return prepare(path, make_settings(categories, **overrides), tmp_path / "jobs", manifest)
    return _run


def rule_ids(result: JobResult, severity: str | None = None) -> Counter:
    return Counter(f["rule_id"] for f in result.report["findings"] if severity is None or f["severity"] == severity)


def findings(result: JobResult, rule_id: str) -> list[dict]:
    return [f for f in result.report["findings"] if f["rule_id"] == rule_id]
