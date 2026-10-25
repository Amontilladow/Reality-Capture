"""Validation: turns manifest rules into traceable findings."""
from __future__ import annotations

from typing import Any

from m4adm.models import Finding, Severity
from m4adm.rules import Manifest


class Collector:
    """Creates findings whose evidence class, default severity and PDF reference come
    from the manifest, so no check can silently promote its own evidence class."""

    def __init__(self, manifest: Manifest):
        self.manifest = manifest
        self.findings: list[Finding] = []

    def add(
        self,
        rule_id: str,
        message: str,
        action: str,
        *,
        severity: Severity | None = None,
        handle: str | None = None,
        layer: str | None = None,
        entity_type: str | None = None,
        location: tuple[float, float] | None = None,
        category: str | None = None,
        blocking: bool = False,
        **details: Any,
    ) -> Finding:
        rule = self.manifest.rule(rule_id)
        f = Finding(
            rule_id=rule_id,
            severity=severity or rule.severity,
            evidence=rule.evidence,
            message=message,
            action=action,
            handle=handle,
            layer=layer,
            entity_type=entity_type,
            location=(round(location[0], 4), round(location[1], 4)) if location else None,
            category=category,
            blocking=blocking,
            ref=rule.ref.text() if rule.ref else None,
            details=details,
        )
        self.findings.append(f)
        return f

    def extend(self, findings: list[Finding]) -> None:
        self.findings.extend(findings)
