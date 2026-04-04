#!/usr/bin/env node
// mcp_compat_test.js — MCP compatibility test harness for toke-cloud.
// Spawns a local server, runs protocol + tool tests, then tears down.
//
// Usage:
//   node test/compatibility/mcp_compat_test.js [--server-url http://localhost:3000] [--verbose]
//
// If --server-url is provided, skips spawn/kill and tests against that URL.
// Otherwise, spawns server.js on a random port.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, "..", "..", "server.js");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
let externalUrl = null;
const urlIdx = args.indexOf("--server-url");
if (urlIdx !== -1 && args[urlIdx + 1]) externalUrl = args[urlIdx + 1];

let passed = 0;
let failed = 0;
const results = [];

function log(...a) {
  if (verbose) console.log("  [verbose]", ...a);
}

function assert(cond, category, label) {
  if (cond) {
    passed++;
    results.push({ category, label, status: "PASS" });
    console.log(`  PASS  [${category}] ${label}`);
  } else {
    failed++;
    results.push({ category, label, status: "FAIL" });
    console.log(`  FAIL  [${category}] ${label}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        })
      );
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function rpcPost(baseUrl, sessionId, payload) {
  const url = `${baseUrl}/mcp/messages?sessionId=${encodeURIComponent(sessionId)}`;
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function connectSSE(baseUrl, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const sseUrl = `${baseUrl}/mcp/sse`;
    const mod = sseUrl.startsWith("https") ? https : http;
    const timer = setTimeout(() => reject(new Error("SSE timeout")), timeoutMs);

    const req = mod.get(sseUrl, (res) => {
      let buf = "";
      res.on("data", (chunk) => {
        buf += chunk.toString();
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const part of parts) {
          const evt = {};
          for (const line of part.split("\n")) {
            if (line.startsWith("event:")) evt.event = line.slice(6).trim();
            else if (line.startsWith("data:")) evt.data = line.slice(5).trim();
          }
          if (evt.event === "endpoint" && evt.data) {
            clearTimeout(timer);
            const match = evt.data.match(/sessionId=([^&]+)/);
            resolve({
              sessionId: match ? match[1] : null,
              endpointUrl: evt.data,
              res,
              close: () => {
                res.destroy();
                req.destroy();
              },
            });
          }
        }
      });
      res.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function initializeSession(baseUrl, sse) {
  await rpcPost(baseUrl, sse.sessionId, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-compat-test", version: "1.0.0" },
    },
  });
  await new Promise((r) => setTimeout(r, 300));
  await rpcPost(baseUrl, sse.sessionId, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  await new Promise((r) => setTimeout(r, 200));
}

// ---------------------------------------------------------------------------
// Server management
// ---------------------------------------------------------------------------

function spawnServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER_JS], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let started = false;

    child.stdout.on("data", (data) => {
      log("server stdout:", data.toString().trim());
      if (!started && data.toString().includes("listening")) {
        started = true;
        resolve(child);
      }
    });
    child.stderr.on("data", (data) => {
      log("server stderr:", data.toString().trim());
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!started) reject(new Error(`Server exited with code ${code}`));
    });

    setTimeout(() => {
      if (!started) reject(new Error("Server failed to start within 10s"));
    }, 10_000);
  });
}

function getRandomPort() {
  return 10000 + Math.floor(Math.random() * 50000);
}

// ---------------------------------------------------------------------------
// Test categories
// ---------------------------------------------------------------------------

async function testSSETransport(baseUrl) {
  console.log("\n=== SSE Transport ===");

  // Connection
  let sse;
  try {
    sse = await connectSSE(baseUrl);
    assert(!!sse.sessionId, "SSE", "connection returns sessionId");
    assert(sse.endpointUrl.includes("/mcp/messages"), "SSE", "endpoint URL contains messages path");
  } catch (err) {
    assert(false, "SSE", `connection established: ${err.message}`);
    return null;
  }

  // Content-type check via health (SSE headers checked implicitly)
  try {
    const r = await request(`${baseUrl}/health`);
    assert(r.headers["content-type"]?.includes("json"), "SSE", "health returns JSON content-type");
  } catch {
    assert(false, "SSE", "health endpoint accessible");
  }

  return sse;
}

async function testJSONRPC(baseUrl, sse) {
  console.log("\n=== JSON-RPC ===");

  // Valid initialize
  const initR = await rpcPost(baseUrl, sse.sessionId, {
    jsonrpc: "2.0",
    id: 100,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "compat-test", version: "1.0.0" },
    },
  });
  assert(
    initR.status === 200 || initR.status === 202,
    "JSON-RPC",
    `initialize accepted (status ${initR.status})`
  );
  await new Promise((r) => setTimeout(r, 300));

  // Send initialized notification
  const notifR = await rpcPost(baseUrl, sse.sessionId, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert(
    notifR.status >= 200 && notifR.status < 300,
    "JSON-RPC",
    `initialized notification accepted (status ${notifR.status})`
  );
  await new Promise((r) => setTimeout(r, 200));

  // Unknown session
  const badR = await rpcPost(baseUrl, "fake-session-000", {
    jsonrpc: "2.0",
    id: 101,
    method: "tools/list",
    params: {},
  });
  assert(badR.status === 400, "JSON-RPC", `unknown session returns 400 (got ${badR.status})`);
}

async function testToolDiscovery(baseUrl, sse) {
  console.log("\n=== Tool Discovery ===");

  const r = await rpcPost(baseUrl, sse.sessionId, {
    jsonrpc: "2.0",
    id: 200,
    method: "tools/list",
    params: {},
  });
  assert(
    r.status === 200 || r.status === 202,
    "Discovery",
    `tools/list accepted (status ${r.status})`
  );
  // Note: actual tool list comes back via SSE; we verify the POST is accepted
  await new Promise((r) => setTimeout(r, 500));
}

async function testToolExecution(baseUrl, sse) {
  console.log("\n=== Tool Execution ===");

  const tools = [
    {
      name: "toke_check",
      args: { source: "M Main { F main() { } }" },
      label: "toke_check with valid source",
    },
    {
      name: "toke_compile",
      args: { source: "M Main { F main() { } }" },
      label: "toke_compile with valid source",
    },
    {
      name: "toke_explain_error",
      args: { error_code: "E1001" },
      label: "toke_explain_error with E1001",
    },
    {
      name: "toke_spec_lookup",
      args: { query: "arrays" },
      label: "toke_spec_lookup for 'arrays'",
    },
    {
      name: "toke_stdlib_ref",
      args: { module: "str" },
      label: "toke_stdlib_ref for 'str' module",
    },
  ];

  let id = 300;
  for (const tool of tools) {
    const r = await rpcPost(baseUrl, sse.sessionId, {
      jsonrpc: "2.0",
      id: id++,
      method: "tools/call",
      params: { name: tool.name, arguments: tool.args },
    });
    assert(
      r.status === 200 || r.status === 202,
      "Execution",
      `${tool.label} — accepted (status ${r.status})`
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Invalid tool name
  const badTool = await rpcPost(baseUrl, sse.sessionId, {
    jsonrpc: "2.0",
    id: id++,
    method: "tools/call",
    params: { name: "nonexistent_tool", arguments: {} },
  });
  assert(
    badTool.status >= 200 && badTool.status < 500,
    "Execution",
    `invalid tool name handled gracefully (status ${badTool.status})`
  );
  await new Promise((r) => setTimeout(r, 300));
}

async function testErrorHandling(baseUrl, sse) {
  console.log("\n=== Error Handling ===");

  // Missing required field (toke_check without source)
  const r1 = await rpcPost(baseUrl, sse.sessionId, {
    jsonrpc: "2.0",
    id: 400,
    method: "tools/call",
    params: { name: "toke_check", arguments: {} },
  });
  assert(
    r1.status >= 200 && r1.status < 500,
    "Errors",
    `missing required field handled (status ${r1.status})`
  );
  await new Promise((r) => setTimeout(r, 300));

  // Oversized payload (100KB source)
  const bigSource = "M Main { F main() { } }\n".repeat(5000);
  const r2 = await rpcPost(baseUrl, sse.sessionId, {
    jsonrpc: "2.0",
    id: 401,
    method: "tools/call",
    params: { name: "toke_check", arguments: { source: bigSource } },
  });
  assert(
    r2.status >= 200 && r2.status < 500,
    "Errors",
    `oversized payload handled (status ${r2.status})`
  );
  await new Promise((r) => setTimeout(r, 300));

  // Malformed JSON-RPC (missing jsonrpc field)
  const r3 = await rpcPost(baseUrl, sse.sessionId, {
    id: 402,
    method: "tools/list",
  });
  assert(
    r3.status >= 200 && r3.status < 500,
    "Errors",
    `malformed JSON-RPC handled (status ${r3.status})`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("MCP Compatibility Test Suite — toke-cloud");
  console.log("==========================================\n");

  let serverProcess = null;
  let baseUrl = externalUrl;

  if (!externalUrl) {
    const port = getRandomPort();
    baseUrl = `http://localhost:${port}`;
    console.log(`Spawning server on port ${port}...`);
    try {
      serverProcess = await spawnServer(port);
      console.log("Server started.");
    } catch (err) {
      console.error(`Failed to start server: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`Testing against external server: ${externalUrl}`);
  }

  try {
    // 1. SSE Transport
    const sse1 = await testSSETransport(baseUrl);
    if (sse1) sse1.close();

    // For remaining tests, open a fresh session and initialize it
    const sse = await connectSSE(baseUrl);
    await initializeSession(baseUrl, sse);

    // 2. JSON-RPC (uses a separate session to test init flow)
    const sse2 = await connectSSE(baseUrl);
    await testJSONRPC(baseUrl, sse2);
    sse2.close();

    // 3. Tool Discovery
    await testToolDiscovery(baseUrl, sse);

    // 4. Tool Execution
    await testToolExecution(baseUrl, sse);

    // 5. Error Handling
    await testErrorHandling(baseUrl, sse);

    sse.close();
  } finally {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      console.log("\nServer stopped.");
    }
  }

  // Summary
  console.log(`\n==========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`==========================================`);

  if (verbose) {
    console.log("\nDetailed results:");
    for (const r of results) {
      console.log(`  [${r.status}] [${r.category}] ${r.label}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
