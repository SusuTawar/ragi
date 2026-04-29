# ragi

Local-first RAG indexing and semantic search MCP server.

Requires Node 22 or newer.

Published/runtime usage is Node-first. Maintainers can still use Bun locally if they prefer, for example `bun install` and `bun run <script>`.

## Quick Start

```bash
# Install dependencies
npm install

# Build and start MCP server
npm run build
npm start

# Or use npx
npx ragi
```

If you prefer Bun locally, the equivalent maintainer flow still works:

```bash
bun install
bun run build
bun run test
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
  },
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434"
    },
    "llama_cpp": {
      "baseUrl": "http://localhost:8080"
    }
  }
}
```

Recommended model choices by provider:
- `ollama`: `nomic-embed-text`
- `transformers_js`: `Xenova/all-MiniLM-L6-v2`
- `llama_cpp`: an embedding-capable model served by your llama.cpp instance

The `providers.*.baseUrl` values control where `ragi` looks for each local service. When `embedding.provider` is `ollama` or `llama_cpp` and `embedding.baseUrl` is unset, `ragi` uses the matching provider-specific `baseUrl` from the global config.

Or use environment variables (RAGI_* takes precedence):
- `RAGI_VECTOR_STORE`
- `RAGI_EMBEDDING_PROVIDER`
- `RAGI_EMBEDDING_MODEL`
- `RAGI_EMBEDDING_BASE_URL`
