"""Layer / feature mapping.

Deterministic mapping only for unambiguous cases:
  * the source layer already carries a verified ADM layer name (exact),
  * a spelling variant that the PDF itself uses for the same layer (alias, flagged),
  * a case-only difference (AutoCAD layer names are case-insensitive, flagged),
  * an engineer-accepted mapping (layer or individual handle).
Everything else goes to the review queue. Meaning is never assigned from colour,
position or geometry. Name-similarity suggestions are shown as hints only and are
never applied without acceptance.
"""
from __future__ import annotations

import difflib
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from m4adm.classify import EntityRecord
from m4adm.models import MappingDecision
from m4adm.rules import Manifest

EXCLUDE = "__exclude__"   # engineer decision: keep out of the ADM files (goes to the additional file)


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


@dataclass
class LayerIndex:
    """ADM layer names reachable for the selected categories."""

    canonical: dict[str, set[str]] = field(default_factory=dict)  # name -> categories
    alias: dict[str, str] = field(default_factory=dict)             # alias -> canonical
    other_categories: dict[str, set[str]] = field(default_factory=dict)

    @classmethod
    def build(cls, manifest: Manifest, categories: list[str]) -> "LayerIndex":
        idx = cls()
        for cat, spec in manifest.categories.items():
            for layer in spec.layers:
                target = idx.canonical if cat in categories else idx.other_categories
                target.setdefault(layer.name, set()).add(cat)
                if cat in categories:
                    for a in layer.aliases:
                        idx.alias[a] = layer.name
        # A shared layer (Title, DimensionLine) selected via one category is not "other".
        for name in list(idx.other_categories):
            if name in idx.canonical:
                del idx.other_categories[name]
        return idx

    def resolve_name(self, name: str) -> tuple[str | None, str]:
        if name in self.canonical:
            return name, "VERIFIED_NAME"
        if name in self.alias:
            return self.alias[name], "ALIAS"
        lowered = name.lower()
        for cand in self.canonical:
            if cand.lower() == lowered:
                return cand, "CASE_VARIANT"
        for a, cand in self.alias.items():
            if a.lower() == lowered:
                return cand, "CASE_VARIANT"
        return None, "UNRESOLVED"

    def suggestions(self, name: str, n: int = 3) -> list[str]:
        norm = _norm(name)
        if not norm:
            return []
        choices = {_norm(c): c for c in self.canonical}
        hits = difflib.get_close_matches(norm, list(choices), n=n, cutoff=0.6)
        return [choices[h] for h in hits]


@dataclass
class MappingResult:
    decisions: list[MappingDecision]
    entity_target: dict[str, str | None]       # handle -> ADM layer (None = not in ADM output)
    entity_status: dict[str, str]              # handle -> decision status
    invalid_user_mappings: list[tuple[str, str]]


def build_mapping(
    records: list[EntityRecord],
    manifest: Manifest,
    categories: list[str],
    layer_mapping: dict[str, str],
    handle_mapping: dict[str, str],
) -> MappingResult:
    idx = LayerIndex.build(manifest, categories)
    by_layer: dict[str, list[EntityRecord]] = defaultdict(list)
    for r in records:
        by_layer[r.layer].append(r)

    invalid: list[tuple[str, str]] = []

    def valid_target(t: str) -> bool:
        return t == EXCLUDE or t in idx.canonical

    decisions: list[MappingDecision] = []
    entity_target: dict[str, str | None] = {}
    entity_status: dict[str, str] = {}
    for layer_name in sorted(by_layer, key=str.lower):
        recs = by_layer[layer_name]
        types = Counter(r.structure for r in recs)
        note = ", ".join(f"{k}x{v}" for k, v in sorted(types.items()))
        target: str | None
        if layer_name in layer_mapping:
            target = layer_mapping[layer_name]
            if not valid_target(target):
                invalid.append((layer_name, target))
                target, status = None, "UNRESOLVED"
            else:
                status = "USER_ACCEPTED"
                if target == EXCLUDE:
                    target = None
        else:
            target, status = idx.resolve_name(layer_name)
            if status == "UNRESOLVED" and layer_name in idx.other_categories:
                status = "OUT_OF_SCOPE"
        cats = sorted(idx.canonical.get(target, set())) if target else []
        decisions.append(
            MappingDecision(
                source_layer=layer_name,
                target_layer=target,
                category=",".join(cats) or None,
                status=status,
                entity_count=len(recs),
                suggestions=idx.suggestions(layer_name) if status == "UNRESOLVED" else [],
                note=note,
            )
        )
        for r in recs:
            entity_target[r.handle] = target
            entity_status[r.handle] = status

    for handle, target in handle_mapping.items():
        if handle not in entity_target:
            invalid.append((f"handle {handle}", target))
            continue
        if not valid_target(target):
            invalid.append((f"handle {handle}", target))
            continue
        entity_target[handle] = None if target == EXCLUDE else target
        entity_status[handle] = "USER_ACCEPTED"
    return MappingResult(decisions, entity_target, entity_status, invalid)


def categories_of(manifest: Manifest, target_layer: str, selected: list[str]) -> list[str]:
    return [c for c in selected if manifest.layer(c, target_layer) is not None]
