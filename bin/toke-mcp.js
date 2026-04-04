#!/usr/bin/env node

// Starts the toke MCP server locally.
// Usage: npx @tokelang/mcp-server [--port 3000] [--tkc-path /path/to/tkc] [--help]

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
toke-mcp -- Toke language MCP server

Usage:
  npx @tokelang/mcp-server [options]

Options:
  --port <number>       HTTP listen port (default: 3000)
  --tkc-path <path>     Path to tkc binary (default: searches PATH)
  --help, -h            Show this help message

Environment variables:
  PORT                  Same as --port
  TKC_PATH              Same as --tkc-path

Examples:
  npx @tokelang/mcp-server
  npx @tokelang/mcp-server --port 8080
  npx @tokelang/mcp-server --tkc-path /usr/local/bin/tkc
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Resolve port
// ---------------------------------------------------------------------------

const port = getArg("--port") || process.env.PORT || "3000";
process.env.PORT = port;

// ---------------------------------------------------------------------------
// Locate tkc binary
// ---------------------------------------------------------------------------

const tkcArg = getArg("--tkc-path") || process.env.TKC_PATH;

function findTkc() {
  // 1. Explicit path from CLI or env
  if (tkcArg) {
    const resolved = resolve(tkcArg);
    if (existsSync(resolved)) return resolved;
    console.error(`Error: tkc binary not found at specified path: ${tkcArg}`);
    process.exit(1);
  }

  // 2. Check PATH
  try {
    const which = execFileSync("which", ["tkc"], { encoding: "utf-8" }).trim();
    if (which) return which;
  } catch {
    // not on PATH
  }

  // 3. Common locations
  const commonPaths = [
    "/usr/local/bin/tkc",
    "/usr/bin/tkc",
    resolve(process.env.HOME || "~", ".local/bin/tkc"),
    resolve(process.env.HOME || "~", "bin/tkc"),
  ];

  for (const p of commonPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

const tkcPath = findTkc();

if (!tkcPath) {
  console.error(`
Error: tkc binary not found.

The toke-mcp server requires the tkc compiler binary to check and compile
Toke source code. Install it from:

  https://tokelang.dev/install

Or specify the path explicitly:

  npx @tokelang/mcp-server --tkc-path /path/to/tkc

Alternatively, set the TKC_PATH environment variable:

  TKC_PATH=/path/to/tkc npx @tokelang/mcp-server
`);
  process.exit(1);
}

process.env.TKC_PATH = tkcPath;

// ---------------------------------------------------------------------------
// Print startup banner
// ---------------------------------------------------------------------------

console.log("");
console.log("  toke-mcp -- Toke Language MCP Server");
console.log("  =====================================");
console.log("");
console.log(`  Port:            ${port}`);
console.log(`  tkc binary:      ${tkcPath}`);
console.log(`  SSE endpoint:    http://localhost:${port}/mcp/sse`);
console.log(`  Health check:    http://localhost:${port}/health`);
console.log("");
console.log("  Available tools:");
console.log("    toke_check          Check Toke source for errors");
console.log("    toke_compile        Compile Toke source to LLVM IR");
console.log("    toke_explain_error  Explain a Toke error code");
console.log("    toke_spec_lookup    Search the Toke language spec");
console.log("    toke_stdlib_ref     Look up stdlib module/function");
console.log("    toke_generate       Generate Toke code from description");
console.log("    toke_bench          Benchmark Toke code against baseline");
console.log("");
console.log("  Connect from Claude Code:");
console.log(`    { "mcpServers": { "toke": { "url": "http://localhost:${port}/mcp/sse" } } }`);
console.log("");

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

import("../server.js");
