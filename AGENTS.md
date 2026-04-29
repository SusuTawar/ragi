
<!-- RAGI:BEGIN -->
Use ragi MCP tools to look up repo information before guessing.

When answering "what/where/how" questions about this repo:
- Prefer `rag_search` first (semantic).
- Use `rag_list_projects` if project path/allowlist is unclear.
- Use `rag_index` if results suggest the repo is not indexed yet.

Inputs: `projectPath` (absolute path), `query`, optional `limit`.
Fallback: if RAG is unavailable/unindexed, use normal file search.
<!-- RAGI:END -->
