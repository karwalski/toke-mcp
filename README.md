# toke-mcp

Self-hostable [MCP](https://modelcontextprotocol.io/) server for the [Toke](https://tokelang.dev) programming language.

Provides 7 tools over SSE transport for AI coding assistants:

| Tool | Description |
|------|-------------|
| `toke_check` | Type-check Toke source, return JSON diagnostics |
| `toke_compile` | Compile Toke to LLVM IR |
| `toke_explain_error` | Explain an error code with fix suggestions |
| `toke_spec_lookup` | Search the language specification |
| `toke_stdlib_ref` | Look up standard library functions |
| `toke_generate` | Generate Toke code from a description |
| `toke_bench` | Benchmark Toke code against a task |

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
- `GET /mcp/sse` — SSE connection endpoint
- `POST /mcp/messages?sessionId=...` — JSON-RPC message endpoint
- `GET /health` — Health check

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `TKC_PATH` | `tkc` | Path to tkc compiler binary |
| `RATE_LIMIT_PER_HOUR` | `100` | Max requests per hour per IP |
| `MAX_CONNECTIONS` | `5` | Max concurrent SSE connections per IP |
| `REDIS_URL` | — | Redis URL for rate limiting (optional, in-memory fallback) |

## Extending

The server exports `createMcpServer()` and `createApp()` for embedding in your own infrastructure:

```javascript
import { createApp, createMcpServer } from "@tokelang/mcp-server";

// Use with custom middleware hooks
const app = createApp({
  onConnect: async (req) => {
    // Custom auth, connection limits, etc.
    return { allowed: true };
  },
  onToolCall: async (req, toolName, clientIp) => {
    // Custom rate limiting, tier checks, etc.
    return { allowed: true, headers: {} };
  },
  onToolComplete: (toolName, clientIp, latencyMs, success) => {
    // Custom usage tracking, telemetry, etc.
  },
});

app.listen(3000);
```

## IDE Integrations

- **VS Code**: See `vscode-toke/` for the extension
- **Claude Code**: See `claude-plugin/` for the Claude Code plugin
- **Neovim/JetBrains**: See the [plugin development guide](https://tokelang.dev/reference/plugin-guide)

## License

Apache-2.0
