# ragi

Local-first RAG indexing and semantic search MCP server.

## Quick Start

```bash
# Install dependencies
bun install

# Start MCP server
bun run src/mcp/server.ts

# Or use npx
npx ragi
```

## Usage

```bash
# Initialize skill locally
npx ragi init

# Initialize skill globally
npx ragi init --global

# Check installations
npx ragi init --check
```

`npx ragi init` now:
- asks which agent(s) are used in the current project,
- checks whether the installed `ragi` skill is missing, current, or outdated before copying,
- checks whether `ragi` is already registered with the selected agent host(s) before offering MCP setup,
- checks `~/.config/ragi/config.json` and can scaffold it when missing or invalid,
- prefers global/user MCP registration by default when the agent's config format is supported,
- falls back to printing manual MCP registration instructions for unsupported agents.

`--force` overwrites outdated installed skills during `init`. Without `--force`, interactive runs ask before updating and non-interactive runs leave stale installs untouched.

## Configuration

The default runtime config lives at `~/.config/ragi/config.json`.

Use a project `.ragrc` only when this repo needs to override the global `ragi` defaults:

```json
{
  "embedding": {
    "provider": "transformers_js",
    "model": "Xenova/all-MiniLM-L6-v2"
  }
}
```

Or use environment variables (RAGI_* takes precedence):
- `RAGI_EMBEDDING_PROVIDER` (or `BUN_RAG_EMBEDDING_PROVIDER`)
- `RAGI_EMBEDDING_MODEL` (or `BUN_RAG_EMBEDDING_MODEL`)
- `RAGI_EMBEDDING_BASE_URL` (or `BUN_RAG_EMBEDDING_BASE_URL`)
