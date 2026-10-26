"""Run one job and pack it as the zip the Reality Capture platform stores.

Shared by the standalone service (m4adm.service) and the command used when the engine runs inside the
platform's AI service as a separate, memory-capped process:

    python -m m4adm.package <drawing> <settings.json> <out.zip>

Prints {"job_id", "status", "label"} as JSON on success. Exit code 2 = the input was rejected (message on
stderr, safe to show the engineer); any other non-zero code = the run itself failed.
"""
from __future__ import annotations

import json
import sys
import tempfile
import zipfile
from pathlib import Path

from pydantic import ValidationError

from m4adm import PROVISIONAL_LABEL
from m4adm.models import JobSettings
from m4adm.pipeline import prepare
from m4adm.rules import PROFILES, Manifest, load_profile

PACKAGE_EXCLUDE = {"input", "work"}          # the platform already holds the original drawing


class InputRejected(ValueError):
    """The drawing or settings cannot be processed as given; retrying the same input will not help."""


def parse_settings(raw: str) -> JobSettings:
    try:
        settings = JobSettings(**json.loads(raw))
    except (ValueError, ValidationError) as exc:
        raise InputRejected(f"invalid settings: {exc}") from exc
    if settings.template_path:
        # A server-side path would let a caller make the service read arbitrary files.
        raise InputRejected("template_path is not accepted by the service")
    if settings.profile not in PROFILES:
        raise InputRejected(f"unknown profile {settings.profile!r}")
    return settings


def build_package(source: Path, settings: JobSettings, out_zip: Path, manifest: Manifest | None = None) -> dict:
    """Run the job in a temporary directory and write the package (everything except input/ and work/)."""
    manifest = manifest or load_profile(settings.profile)
    with tempfile.TemporaryDirectory(prefix="m4adm-") as tmp:
        try:
            result = prepare(source, settings, Path(tmp) / "jobs", manifest)
        except (ValueError, FileNotFoundError) as exc:
            raise InputRejected(str(exc)) from exc
        with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(result.job_dir.rglob("*")):
                rel = f.relative_to(result.job_dir)
                if f.is_file() and rel.parts[0] not in PACKAGE_EXCLUDE:
                    z.write(f, rel.as_posix())
    return {"job_id": result.job_id, "status": result.status, "label": PROVISIONAL_LABEL}


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 3:
        print("usage: python -m m4adm.package <drawing> <settings.json> <out.zip>", file=sys.stderr)
        return 2
    drawing, settings_file, out_zip = (Path(a) for a in args)
    try:
        settings = parse_settings(settings_file.read_text(encoding="utf-8"))
        meta = build_package(drawing, settings, out_zip)
    except InputRejected as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except MemoryError:
        print("The drawing needs more memory than this server allows. Run it with the desktop tool "
              "(m4adm ui) instead.", file=sys.stderr)
        return 3
    print(json.dumps(meta))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
