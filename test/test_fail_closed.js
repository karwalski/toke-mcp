// 121.14 (audit 120.15 TOK-01): the rate limit and the connection limit fail
// CLOSED. They are the public server's only guard against unbounded tkc
// spawning, so a store that errors, a store that is full, a limit that does
// not parse, or a client-chosen tool name must each mean "refuse", never
// "count nothing".
//
// Before 121.14:
//   - rate-limiter.cjs caught any store error and returned allowed:true;
//   - getConnectionCount caught any store error and returned 0;
//   - MAX_CONNECTIONS=five parsed to NaN, and count >= NaN is false;
//   - each tool NAME had its own bucket, so a new name was a new, empty one;
//   - the in-process store never dropped a key nobody read again.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const redis = require("../lib/redis-client.cjs");
const { checkRateLimit } = require("../lib/rate-limiter.cjs");
const { getConnectionCount } = require("../lib/connection-registry.cjs");
const { checkToolRateLimit, checkConnectionLimit } = require("../lib/rate-limit-middleware.cjs");

const realGetClient = redis.getClient;
function breakStore(how) {
  redis.getClient = async () => {
    if (how === "connect") throw new Error("injected: store unreachable");
    const c = await realGetClient();
    const broken = Object.create(c);
    broken.multi = () => { throw new Error("injected: store error"); };
    broken.zRemRangeByScore = async () => { throw new Error("injected: store error"); };
    broken.zCard = async () => { throw new Error("injected: store error"); };
    return broken;
  };
}

beforeEach(async () => { redis.getClient = realGetClient; await redis.disconnect(); });
afterEach(() => { redis.getClient = realGetClient; });

describe("store failure refuses (TOK-01)", () => {
  for (const how of ["connect", "command"]) {
    it(`rate limiter refuses when the store fails (${how})`, async () => {
      breakStore(how);
      const r = await checkRateLimit("fc:k", 100, 60);
      assert.equal(r.allowed, false);
      assert.equal(r.unavailable, true);
      assert.ok(r.retryAfter >= 1);
    });

    it(`connection count throws when the store fails (${how})`, async () => {
      breakStore(how);
      await assert.rejects(getConnectionCount("1.1.1.1"));
    });

    it(`connection limit refuses with 503 when the store fails (${how})`, async () => {
      breakStore(how);
      const r = await checkConnectionLimit({ clientIp: "1.1.1.1" });
      assert.equal(r.allowed, false);
      assert.equal(r.statusCode, 503);
    });
  }

  it("tool middleware answers 503 with Retry-After when the store fails", async () => {
    breakStore("command");
    const r = await checkToolRateLimit({ tool: "toke_check", clientIp: "2.2.2.2" });
    assert.equal(r.allowed, false);
    assert.equal(r.statusCode, 503);
    assert.ok(Number(r.headers["Retry-After"]) >= 1);
    assert.equal(JSON.parse(r.body).error, "limit_unavailable");
  });
});

describe("client-chosen tool names share one bucket", () => {
  it("a new unknown name does not get a fresh allowance", async () => {
    const known = new Set(["toke_check"]);
    const cfg = { limit: 2, windowSec: 60 };
    const r = [];
    for (const tool of ["nope_1", "nope_2", "nope_3"]) {
      r.push((await checkToolRateLimit({ tool, clientIp: "3.3.3.3", config: cfg, knownTools: known })).allowed);
    }
    assert.deepEqual(r, [true, true, false]);
    const k = await checkToolRateLimit({ tool: "toke_check", clientIp: "3.3.3.3", config: cfg, knownTools: known });
    assert.equal(k.allowed, true, "a known tool keeps its own bucket");
  });
});

describe("the in-process store is bounded", () => {
  it("sweeps keys that expired and were never read again", async () => {
    const c = await redis.getClient();
    for (let i = 0; i < 50; i++) await c.set(`old:${i}`, "x", { EX: 0.001 });
    await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i < 1000; i++) await c.set("hot", String(i));
    assert.ok(c.size() <= 2, `size after sweep: ${c.size()}`);
  });
});

// Environment is read when the modules load, so these run in a child.
function childJs(env, code) {
  return execFileSync(process.execPath, ["-e", code], {
    cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf-8",
  }).trim();
}

describe("configuration that does not parse keeps the default", () => {
  it("MAX_CONNECTIONS=five still limits at the default 5", () => {
    const out = childJs({ MAX_CONNECTIONS: "five" }, `
      const { registerConnection } = require("./lib/connection-registry.cjs");
      const { checkConnectionLimit } = require("./lib/rate-limit-middleware.cjs");
      (async () => {
        for (let i = 0; i < 5; i++) await registerConnection("c" + i, { ip: "4.4.4.4" });
        const r = await checkConnectionLimit({ clientIp: "4.4.4.4" });
        console.log(r.allowed ? "allowed" : "refused");
      })();`);
    assert.equal(out.split("\n").pop(), "refused");
  });

  it("RATE_LIMIT_PER_HOUR=lots still limits at the default 100", () => {
    const out = childJs({ RATE_LIMIT_PER_HOUR: "lots" }, `
      const { checkToolRateLimit } = require("./lib/rate-limit-middleware.cjs");
      (async () => {
        let last;
        for (let i = 0; i < 101; i++) last = await checkToolRateLimit({ tool: "t", clientIp: "5.5.5.5" });
        console.log(last.allowed ? "allowed" : "refused", last.headers["X-RateLimit-Limit"]);
      })();`);
    assert.equal(out.split("\n").pop(), "refused 100");
  });

  it("a full store refuses new work instead of growing", () => {
    const out = childJs({ STORE_MAX_KEYS: "3" }, `
      const { checkToolRateLimit } = require("./lib/rate-limit-middleware.cjs");
      (async () => {
        const r = [];
        for (let i = 0; i < 5; i++) r.push((await checkToolRateLimit({ tool: "t", clientIp: "6.6.6." + i })).statusCode || 200);
        console.log(r.join(","));
      })();`);
    assert.equal(out.split("\n").pop(), "200,200,200,503,503");
  });
});

// ---------------------------------------------------------------------------
// Through the real HTTP server: SSE session, then tools/call messages.
// ---------------------------------------------------------------------------

function startServer(env) {
  return new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ["server.js"], {
      cwd: ROOT, env: { ...process.env, PORT: String(port), ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (d) => {
      out += d;
      if (out.includes("listening")) { child.stdout.off("data", onData); resolve({ child, port }); }
    };
    child.stdout.on("data", onData);
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
    setTimeout(() => reject(new Error(`server did not start: ${out}`)), 10000).unref();
  });
}

function openSession(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path: "/mcp/sse" }, (res) => {
      if (res.statusCode !== 200) { resolve({ status: res.statusCode, req }); res.resume(); return; }
      let buf = "";
      res.on("data", (d) => {
        buf += d;
        const m = buf.match(/sessionId=([0-9a-f-]+)/);
        if (m) resolve({ status: 200, sessionId: m[1], req });
      });
    });
    req.on("error", reject);
  });
}

async function post(port, sessionId, body) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp/messages?sessionId=${sessionId}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  await res.text();
  return res.status;
}

const call = (id, name) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { query: "let" } } });

describe("HTTP server", () => {
  it("refuses the tool call past RATE_LIMIT_PER_HOUR with 429", async () => {
    const { child, port } = await startServer({ RATE_LIMIT_PER_HOUR: "2" });
    try {
      const s = await openSession(port);
      assert.equal(s.status, 200);
      const codes = [];
      for (let i = 1; i <= 3; i++) codes.push(await post(port, s.sessionId, call(i, "toke_spec_lookup")));
      assert.deepEqual(codes, [202, 202, 429]);
      s.req.destroy();
    } finally { child.kill(); }
  });

  it("refuses tool calls with 503 once the store is full, instead of allowing them", async () => {
    // The first SSE session's bookkeeping fills a 2-key store; the next
    // tools/call needs a new bucket, cannot get one, and is refused.
    const { child, port } = await startServer({ STORE_MAX_KEYS: "2" });
    try {
      const s = await openSession(port);
      assert.equal(s.status, 200);
      assert.equal(await post(port, s.sessionId, call(1, "toke_spec_lookup")), 503);
      s.req.destroy();
    } finally { child.kill(); }
  });
});
