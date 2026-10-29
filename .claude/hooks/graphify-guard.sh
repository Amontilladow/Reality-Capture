#!/usr/bin/env bash
# PreToolUse hook: nudge Claude toward the graphify knowledge graph.
# Finds graphify on PATH or at the Windows per-user install; no-ops if absent.
if command -v graphify >/dev/null 2>&1; then
  exec graphify hook-guard "$@"
fi
win="${APPDATA:-$HOME/AppData/Roaming}/Python/Python314/Scripts/graphify.exe"
if [ -x "$win" ]; then
  exec "$win" hook-guard "$@"
fi
exit 0
