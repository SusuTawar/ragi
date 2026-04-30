# Changelog

All notable changes to `ragi` will be documented in this file.

The format is based on Keep a Changelog and uses lightweight semver tags.

## [0.1.2] - 2026-05-01

- Fix init script doesnt work on windows

## [0.1.1] - 2026-04-30

- Fix package rename fallout so generated `npx` and MCP registration snippets use `@susutawar/ragi` while the CLI/MCP server name remains `ragi`.
- Add a GitHub Actions `publish.yml` workflow for npm Trusted Publisher with OIDC provenance.
- Remove the unused top-level `sharp` dependency and document `sharp.node` troubleshooting for Node users.

## [0.1.0] - 2026-04-29

- Initial release of the `ragi` local-first RAG indexing and semantic search MCP server.
- Ship the CLI entrypoint, MCP server, init flow, and Bun-based test suite.
