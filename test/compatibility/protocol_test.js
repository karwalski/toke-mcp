#!/usr/bin/env node
// protocol_test.js — Pure HTTP/SSE protocol compliance test for any MCP server.
// No MCP SDK dependency. Tests SSE transport + JSON-RPC message flow.
//
// Usage: node protocol_test.js [--server-url http://localhost:3000] [--verbose]

import http from "node:http";
import https from "node:https";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
let serverUrl = "http://localhost:3000";
const urlIdx = args.indexOf("--server-url");
if (urlIdx !== -1 && args[urlIdx + 1]) serverUrl = args[urlIdx + 1];

const SSE_ENDPOINT = `${serverUrl}/mcp/sse`;
const MSG_ENDPOINT = `${serverUrl}/mcp/messages`;
const HEALTH_ENDPOINT = `${serverUrl}/health`;

let passed = 0;
let failed = 0;

function log(...a) {
  if (verbose) console.log("  [verbose]", ...a);
}

function assert(cond, label) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple HTTP(S) request returning { status, headers, body }. */
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

/** POST JSON-RPC to the messages endpoint. */
async function rpcPost(sessionId, payload) {
  const url = `${MSG_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`;
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Connect to SSE endpoint. Returns a promise that resolves with the first
 * "endpoint" event data (which contains the messages URL with sessionId).
 * Also returns a handle to close the connection.
 */
function connectSSE(timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const mod = SSE_ENDPOINT.startsWith("https") ? https : http;
    const timer = setTimeout(() => {
      reject(new Error("SSE connection timed out"));
    }, timeoutMs);

    const req = mod.get(SSE_ENDPOINT, (res) => {
      let buf = "";
      const events = [];

      res.on("data", (chunk) => {
        buf += chunk.toString();
        // Parse SSE events from buffer
        const parts = buf.split("\n\n");
        buf = parts.pop(); // keep incomplete tail
        for (const part of parts) {
          const evt = {};
          for (const line of part.split("\n")) {
            if (line.startsWith("event:")) evt.event = line.slice(6).trim();
            else if (line.startsWith("data:")) evt.data = line.slice(5).trim();
            else if (line.startsWith(":")) evt.comment = line.slice(1).trim();
          }
          events.push(evt);
          log("SSE event:", JSON.stringify(evt));

          // The MCP SDK sends an "endpoint" event with the messages URL
          if (evt.event === "endpoint" && evt.data) {
            clearTimeout(timer);
            // Extract sessionId from the endpoint URL
            const match = evt.data.match(/sessionId=([^&]+)/);
            const sessionId = match ? match[1] : null;
            resolve({
              sessionId,
              endpointUrl: evt.data,
              events,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testHealthEndpoint() {
  console.log("\n--- Health endpoint ---");
  try {
    const r = await request(HEALTH_ENDPOINT);
    assert(r.status === 200, "GET /health returns 200");
    const body = JSON.parse(r.body);
    assert(body.status === "ok", "health status is ok");
    assert(typeof body.version === "string", "health includes version string");
    log("Health body:", r.body);
  } catch (err) {
    assert(false, `health endpoint reachable: ${err.message}`);
  }
}

async function testSSEConnection() {
  console.log("\n--- SSE transport ---");
  let sse;
  try {
    sse = await connectSSE();
    assert(!!sse.sessionId, "SSE connection returns sessionId");
    assert(sse.endpointUrl.includes("/mcp/messages"), "endpoint URL points to messages path");
    log("sessionId:", sse.sessionId);
  } catch (err) {
    assert(false, `SSE connection established: ${err.message}`);
    return null;
  }
  return sse;
}

async function testJSONRPCInitialize(sse) {
  console.log("\n--- JSON-RPC initialize ---");
  const initReq = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "protocol-test", version: "1.0.0" },
    },
  };

  const r = await rpcPost(sse.sessionId, initReq);
  // The MCP SSE transport returns 202 Accepted for POST messages
  // and sends the actual response via the SSE stream
  assert(r.status === 200 || r.status === 202, `initialize POST accepted (status ${r.status})`);
  log("initialize response status:", r.status, "body:", r.body);

  // Wait briefly for SSE events to arrive
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Send initialized notification
  const notif = {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  };
  const r2 = await rpcPost(sse.sessionId, notif);
  assert(
    r2.status === 200 || r2.status === 202 || r2.status === 204,
    `initialized notification accepted (status ${r2.status})`
  );
}

async function testToolsList(sse) {
  console.log("\n--- Tool discovery (tools/list) ---");
  const listReq = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  };

  const r = await rpcPost(sse.sessionId, listReq);
  assert(r.status === 200 || r.status === 202, `tools/list POST accepted (status ${r.status})`);

  // Wait for SSE response
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function testToolCall(sse) {
  console.log("\n--- Tool execution (tools/call) ---");
  const callReq = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "toke_check",
      arguments: { source: 'M Main { F main() { } }' },
    },
  };

  const r = await rpcPost(sse.sessionId, callReq);
  assert(r.status === 200 || r.status === 202, `tools/call POST accepted (status ${r.status})`);
  log("tools/call response:", r.status, r.body);

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function testInvalidSession() {
  console.log("\n--- Error handling ---");
  const r = await rpcPost("nonexistent-session-id", {
    jsonrpc: "2.0",
    id: 99,
    method: "tools/list",
    params: {},
  });
  assert(r.status === 400, `unknown session returns 400 (got ${r.status})`);
  log("invalid session response:", r.body);
}

async function testMalformedRequest(sse) {
  console.log("\n--- Malformed requests ---");
  // Missing jsonrpc field
  const r = await rpcPost(sse.sessionId, { id: 10, method: "tools/list" });
  // Server should either reject or handle gracefully
  assert(
    r.status >= 200 && r.status < 500,
    `malformed request handled without server crash (status ${r.status})`
  );
  log("malformed request response:", r.status, r.body);
}

async function testCORS() {
  console.log("\n--- CORS headers ---");
  const r = await request(HEALTH_ENDPOINT, { method: "OPTIONS" });
  const acao = r.headers["access-control-allow-origin"];
  assert(acao === "*", `CORS Allow-Origin header present (got: ${acao})`);
  const acam = r.headers["access-control-allow-methods"];
  assert(
    acam && acam.includes("POST"),
    `CORS Allow-Methods includes POST (got: ${acam})`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nMCP Protocol Compliance Test`);
  console.log(`Server: ${serverUrl}\n`);

  await testHealthEndpoint();
  await testCORS();
  await testInvalidSession();

  const sse = await testSSEConnection();
  if (!sse) {
    console.log("\nCannot continue — SSE connection failed.");
    process.exit(1);
  }

  try {
    await testJSONRPCInitialize(sse);
    await testToolsList(sse);
    await testToolCall(sse);
    await testMalformedRequest(sse);
  } finally {
    sse.close();
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
