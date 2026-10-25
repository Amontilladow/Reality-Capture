"""Append-only audit trail.

Every automated change, every unresolved decision and every user action is written as
one JSON line. Lines are flushed and fsync'ed immediately so a crash never loses the
record of what already happened.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class AuditLog:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.events: list[dict[str, Any]] = []

    def record(self, event: str, **data: Any) -> dict[str, Any]:
        entry = {"ts": utc_now(), "event": event, **data}
        self.events.append(entry)
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, default=str, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        return entry

    @staticmethod
    def read(path: Path) -> list[dict[str, Any]]:
        if not Path(path).exists():
            return []
        with open(path, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]
