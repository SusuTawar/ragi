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

## Configuration

Create a `.ragrc` file in your project:

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