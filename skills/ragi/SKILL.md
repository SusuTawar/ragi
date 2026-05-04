---
name: ragi
description: RAG indexing and semantic search for local projects via MCP
---

# ragi - Local RAG

RAG (Retrieval-Augmented Generation) indexing and semantic search tool for local projects.

## When to Use

- When you need to index a codebase for semantic search
- When you need to search across project files by meaning, not just text
- When building context for AI agents to understand your codebase

## Available Tools

### rag_index

Index a project for RAG capabilities.

**Parameters:**
- `projectPath` (string, required): Absolute path to the project directory to index
- `paths` (array of strings, optional): Specific files or directories to index (relative to projectPath). If not provided, indexes entire project.

**Example:**
```json
{
  "tool": "rag_index",
  "arguments": {
    "projectPath": "/path/to/project"
  }
}
```

### rag_search

Search within an indexed project.

**Parameters:**
- `projectPath` (string, required): Absolute path to the project directory
- `query` (string, required): The search query
- `limit` (number, optional): Maximum results to return. Defaults to 5

**Example:**
```json
{
  "tool": "rag_search",
  "arguments": {
    "projectPath": "/path/to/project",
    "query": "How to implement authentication?",
    "limit": 10
  }
}
```

### rag_list_projects

List and validate indexed projects.

**Parameters:**
- `projectPath` (string, optional): Validate specific path

**Example:**
```json
{
  "tool": "rag_list_projects",
  "arguments": {}
}
```

## Configuration

Configure via `.ragrc` file or environment variables:

```json
{
  "embedding": {
    "provider": "transformers_js",
    "model": "Xenova/all-MiniLM-L6-v2"
  },
  "chunking": {
    "maxSize": 512,
    "overlap": 50
  }
}
```

| Variable | Description |
|----------|-------------|
| `RAGI_EMBEDDING_PROVIDER` | Provider: `ollama`, `transformers_js`, `llama_cpp` |
| `RAGI_EMBEDDING_MODEL` | Model name |
| `RAGI_EMBEDDING_BASE_URL` | API base URL for Ollama/Llama.cpp |

## Installation

```bash
npx -y @susutawar/ragi@latest init      # Install skill locally
npx -y @susutawar/ragi@latest init -g   # Install skill globally
```

After install, configure your MCP client:
```json
{
  "mcpServers": {
    "ragi": {
      "command": "npx",
      "args": ["-y", "@susutawar/ragi@latest"]
    }
  }
}
```
