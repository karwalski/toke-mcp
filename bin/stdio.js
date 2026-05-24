#!/usr/bin/env node

// Stdio transport entry point for Claude Code MCP integration.
// Usage: node bin/stdio.js
//
// Required env vars:
//   TKC_PATH       - path to the toke compiler binary (default: searches PATH)
//   TOKE_API_KEY   - API key for the toke_generate tool (optional but needed for generate)

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../server.js";

// Resolve TKC_PATH if not set
if (!process.env.TKC_PATH) {
  process.env.TKC_PATH = "tkc";
}

const server = createMcpServer({
  name: "toke-mcp",
});

const transport = new StdioServerTransport();
await server.connect(transport);
