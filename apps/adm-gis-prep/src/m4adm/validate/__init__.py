"""Validation: turns manifest rules into traceable findings."""
from __future__ import annotations

from collections import Counter
from typing import Any

from m4adm.models import Finding, Severity
from m4adm.rules import Manifest


class Collector:
    """Creates findings whose evidence class, default severity and PDF reference come
    from the manifest, so no check can silently promote its own evidence class."""

    def __init__(self, manifest: Manifest):
        self.manifest = manifest
        self.findings: list[Finding] = []
        # generic rule id -> times it fired but is not applicable in this profile (reported, never hidden)
        self.not_applicable: Counter = Counter()

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
    ) -> Finding | None:
        resolved = self.manifest.resolve(rule_id)
        if resolved is None:
            self.not_applicable[rule_id] += 1
            return None
        rule = self.manifest.rule(resolved)
        if resolved != rule_id:
            details.setdefault("generic_rule", rule_id)
        rule_id = resolved
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
        if rule.qc_error:
            f.details.setdefault("official_qc_error", rule.qc_error)
        self.findings.append(f)
        return f

    def extend(self, findings: list[Finding]) -> None:
        self.findings.extend(findings)
