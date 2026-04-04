# Toke Language Support for OpenAI Codex CLI

Project-level instructions and MCP configuration for using the Toke programming language with OpenAI Codex CLI.

## Setup

1. Copy `codex.md` into your Toke project root (or a parent directory). Codex CLI reads `codex.md` files for project-level instructions.

2. Copy `mcp.json` into your Toke project root. This configures the MCP connection to the hosted Toke compiler service, providing `toke_check` and `toke_compile` tools.

## Files

| File | Purpose |
|------|---------|
| `codex.md` | Toke language reference, syntax guide, examples, and check-repair loop instructions |
| `mcp.json` | MCP server configuration pointing to `mcp.tokelang.dev` SSE endpoint |

## What You Get

- Codex understands Toke syntax, keywords, type system, and idioms
- `toke_check` tool validates source code and returns structured diagnostics
- `toke_compile` tool compiles source to LLVM IR
- Check-repair loop instructions so Codex iterates until code is correct
