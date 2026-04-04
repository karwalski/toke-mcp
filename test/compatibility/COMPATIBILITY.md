# Toke MCP Server — Compatibility Matrix

Server URL: `https://mcp.tokelang.dev/mcp/sse`

## Compatibility Table

| Tool | SSE Support | Tool Discovery | toke_check | toke_compile | toke_explain_error | toke_spec_lookup | toke_stdlib_ref | Notes |
|------|-------------|----------------|------------|--------------|-------------------|-----------------|----------------|-------|
| **Claude Code** | verified | verified | verified | verified | verified | verified | verified | Native SSE MCP support. Config: `.mcp.json` in project root. |
| **Codex CLI** | verified | verified | verified | verified | verified | verified | verified | SSE transport via `mcp.json`. Requires `"type": "sse"`. |
| **Cursor** | expected | expected | expected | expected | expected | expected | expected | MCP support via Settings > MCP. SSE transport supported. |
| **Windsurf** | expected | expected | expected | expected | expected | expected | expected | MCP via Windsurf Settings. Uses `serverUrl` key (not `url`). |
| **Cline** | expected | expected | expected | expected | expected | expected | expected | VS Code extension. Requires `"transportType": "sse"` in config. |
| **Aider** | expected | expected | expected | expected | expected | expected | expected | Experimental MCP support (v0.82+). SSE transport. |

### Status legend

- **verified** — tested and confirmed working
- **expected** — should work based on MCP spec compliance; not yet manually verified
- **untested** — not yet evaluated
- **not supported** — tool does not support the required feature

## Setup Instructions

### Claude Code

Place `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "toke": {
      "url": "https://mcp.tokelang.dev/mcp/sse"
    }
  }
}
```

Or install globally at `~/.claude/.mcp.json`.

### Codex CLI

Place `mcp.json` in your project root:

```json
{
  "mcpServers": {
    "toke": {
      "type": "sse",
      "url": "https://mcp.tokelang.dev/mcp/sse"
    }
  }
}
```

### Cursor

1. Open Settings > MCP
2. Click "Add new MCP server"
3. Set URL to `https://mcp.tokelang.dev/mcp/sse`

Or place `.cursor/mcp.json` in your project root with the config from `configs/cursor.json`.

### Windsurf

1. Open Windsurf Settings > MCP
2. Add a new server with URL `https://mcp.tokelang.dev/mcp/sse`

Or edit `~/.codeium/windsurf/mcp_config.json`. Note: Windsurf uses `serverUrl` instead of `url`.

### Cline

1. Open the Cline extension panel in VS Code
2. Go to MCP settings
3. Add the server with URL `https://mcp.tokelang.dev/mcp/sse` and transport type `sse`

### Aider

MCP support in Aider is experimental (v0.82+). Use the `--mcp-server` flag:

```bash
aider --mcp-server "toke=https://mcp.tokelang.dev/mcp/sse"
```

Or add to `.aider.conf.yml`:

```yaml
mcp-server:
  - "toke=https://mcp.tokelang.dev/mcp/sse"
```

## Known Limitations

| Tool | Limitation |
|------|-----------|
| **All tools** | SSE connections may time out after extended idle periods. Server sends keep-alive pings to mitigate. |
| **Windsurf** | Uses `serverUrl` key rather than `url` in MCP config — different from MCP spec convention. |
| **Cline** | Requires explicit `"transportType": "sse"` — does not auto-detect from URL. |
| **Aider** | MCP support is experimental. Tool descriptions may not surface in all prompting modes. |
| **Self-hosted** | When running via Docker, replace the hosted URL with your local server URL (e.g., `http://localhost:3000/mcp/sse`). |

## Running Automated Tests

### Full compatibility test (spawns local server):

```bash
node test/compatibility/mcp_compat_test.js --verbose
```

### Against a running server:

```bash
node test/compatibility/mcp_compat_test.js --server-url https://mcp.tokelang.dev --verbose
```

### Protocol-only test (pure HTTP/SSE, no SDK):

```bash
node test/compatibility/protocol_test.js --server-url https://mcp.tokelang.dev --verbose
```

## Last Updated

2026-04-04
