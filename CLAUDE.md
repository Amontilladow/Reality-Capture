## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Always use graphify in this repo: the graphify skill lives at `.claude/skills/graphify/SKILL.md` — load it for any codebase, architecture or file-relationship question.

Rules:
- If the `graphify` command is missing (fresh cloud container), install it first: `pip install graphifyy`. If graphify-out/graph.json is missing, build it with `graphify update .`.
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
