#!/usr/bin/env bash
# SessionStart hook: make sure graphify is installed in cloud sessions and the
# graph exists, so the CLAUDE.md graphify rules work from the first turn.
[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! command -v graphify >/dev/null 2>&1; then
  pip install -q graphifyy >/dev/null 2>&1 || exit 0
fi
if [ ! -f graphify-out/graph.json ]; then
  graphify update . >/dev/null 2>&1 || true
fi
exit 0
