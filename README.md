# toke-mcp

[![npm](https://img.shields.io/npm/v/@tokelang/mcp-server)](https://www.npmjs.com/package/@tokelang/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Connect your AI coding assistant to the [Toke](https://tokelang.dev) programming language. This MCP server gives tools like Claude, Cursor, and VS Code the ability to write, compile, and understand toke code. It implements the [Model Context Protocol](https://modelcontextprotocol.io/) with 14 tools, SSE transport, rate limiting, and IDE integrations.

## Features

- **14 MCP tools** for compiling, checking, formatting, generating, and analysing toke code
- **SSE transport** with session management and health checks
- **Rate limiting** with in-memory or Redis-backed storage
- **IDE integrations** for Claude Code, VS Code, and Codex CLI
- **Embeddable** -- export `createMcpServer()` and `createApp()` for custom infrastructure
- **Self-hostable** with Docker or standalone Node.js

## Quick Start

```bash
# Requires: Node.js >= 18, tkc compiler on PATH
npm install @tokelang/mcp-server
npx toke-mcp
```

Or with Docker:

```bash
docker compose up
```

The server starts on `http://localhost:3000` with:

- `GET /mcp/sse` -- SSE connection endpoint
- `POST /mcp/messages?sessionId=...` -- JSON-RPC message endpoint
- `GET /health` -- Health check

## Available Tools

| Tool | Description |
|------|-------------|
| `toke_check` | Check toke source code for errors, returns JSON diagnostics |
| `toke_compile` | Compile toke source to LLVM IR |
| `toke_explain_error` | Look up an error code with fix suggestions |
| `toke_spec_lookup` | Search the language specification by keyword |
| `toke_stdlib_ref` | Look up standard library module or function docs |
| `toke_generate` | Generate toke code from a natural-language description |
| `toke_bench` | Benchmark toke code against known tasks |
| `toke_companion` | Generate, verify, or diff `.tkc.md` companion files |
| `toke_format` | Auto-format toke source code |
| `toke_migrate` | Migrate legacy 80-char syntax to 56-char default syntax |
| `toke_compress` | Compress text using toke compression |
| `toke_decompress` | Decompress toke-compressed text |
| `toke_analyse` | Pre-flight token budget estimation without modifying input |
| `toke_render` | Render parameterised templates with `{{varname}}` substitution |

For detailed input/output schemas, see [TOOLS.md](TOOLS.md).

## IDE Integration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "toke": {
      "command": "npx",
      "args": ["toke-mcp"]
    }
  }
}
```

### Claude Code

Copy the plugin into your project:

```bash
cp -r claude-plugin/.mcp.json .mcp.json
cp -r claude-plugin/CLAUDE.md CLAUDE.md
cp -r claude-plugin/skills/ skills/
cp -r claude-plugin/commands/ commands/
```

See [`claude-plugin/README.md`](claude-plugin/README.md) for full details.

### VS Code

Install the extension from source:

```bash
cd vscode-toke
npm install && npm run compile
npx vsce package
code --install-extension toke-language-0.1.0.vsix
```

See [`vscode-toke/README.md`](vscode-toke/README.md) for configuration and snippets.

### Cursor

Add to your Cursor MCP settings (Settings > MCP Servers):

```json
{
  "toke": {
    "command": "npx",
    "args": ["toke-mcp"]
  }
}
```

### Codex CLI

Copy `codex/codex.md` and `codex/mcp.json` into your project root. See [`codex/README.md`](codex/README.md).

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `TKC_PATH` | `tkc` | Path to tkc compiler binary |
| `RATE_LIMIT_PER_HOUR` | `100` | Max requests per hour per IP |
| `MAX_CONNECTIONS` | `5` | Max concurrent SSE connections per IP |
| `REDIS_URL` | -- | Redis URL for rate limiting (optional, in-memory fallback) |
| `TOKE_TELEMETRY` | -- | Set to `1` to enable local telemetry recording. When enabled, source code that passes `toke_check` or compiles successfully is saved (with string literals stripped) to `~/.toke/telemetry/` for potential corpus inclusion. Files are deduplicated by content hash. No data is sent to any server. |

## Extending

The server exports `createMcpServer()` and `createApp()` for embedding in your own infrastructure:

```javascript
import { createApp, createMcpServer } from "@tokelang/mcp-server";

const app = createApp({
  onConnect: async (req) => {
    return { allowed: true };
  },
  onToolCall: async (req, toolName, clientIp) => {
    return { allowed: true, headers: {} };
  },
  onToolComplete: (toolName, clientIp, latencyMs, success) => {
    // Usage tracking, telemetry, etc.
  },
});

app.listen(3000);
```

## Project Structure

```
toke-mcp/
  server.js              MCP server with all 14 tools registered
  tools/                 Individual tool implementations
  lib/                   Rate limiting, connection registry, caching
  bin/                   CLI entry point (npx toke-mcp)
  skills/                Language skill definition
  claude-plugin/         Claude Code plugin (MCP config, skills, commands)
  codex/                 Codex CLI integration
  vscode-toke/           VS Code extension (syntax, snippets, LSP client)
  lsp/                   Language server (diagnostics, hover, symbols)
  lambda/                AWS Lambda handlers
  test/                  Tests and compatibility suite
  scripts/               Build and publish scripts
```

## Self-Hosting

See [SELF_HOSTED.md](SELF_HOSTED.md) for Docker deployment and production configuration.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and how to add new tools.

## Related Repositories

- [toke](https://github.com/karwalski/toke) -- the toke compiler, spec, and stdlib this server wraps (`tkc`)
- [toke-corpus](https://github.com/karwalski/toke-corpus) -- training-data generation (opt-in telemetry from this server can feed it)
- [toke-model](https://github.com/karwalski/toke-models) -- model training behind `toke_generate`
- [toke-tokenizer](https://github.com/karwalski/toke-tokenizer) -- custom tokenizer used for token-budget analysis

## License

[MIT](LICENSE)
