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
import { describe, it, after, beforeEach, afterEach } from "node:test";
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
      await assert.rejects(getConnectionCount("192.0.2.1"));
    });

    it(`connection limit refuses with 503 when the store fails (${how})`, async () => {
      breakStore(how);
      const r = await checkConnectionLimit({ clientIp: "192.0.2.1" });
      assert.equal(r.allowed, false);
      assert.equal(r.statusCode, 503);
    });
  }

  it("tool middleware answers 503 with Retry-After when the store fails", async () => {
    breakStore("command");
    const r = await checkToolRateLimit({ tool: "toke_check", clientIp: "192.0.2.2" });
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
      r.push((await checkToolRateLimit({ tool, clientIp: "192.0.2.3", config: cfg, knownTools: known })).allowed);
    }
    assert.deepEqual(r, [true, true, false]);
    const k = await checkToolRateLimit({ tool: "toke_check", clientIp: "192.0.2.3", config: cfg, knownTools: known });
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
        for (let i = 0; i < 5; i++) await registerConnection("c" + i, { ip: "192.0.2.4" });
        const r = await checkConnectionLimit({ clientIp: "192.0.2.4" });
        console.log(r.allowed ? "allowed" : "refused");
      })();`);
    assert.equal(out.split("\n").pop(), "refused");
  });

  it("RATE_LIMIT_PER_HOUR=lots still limits at the default 100", () => {
    const out = childJs({ RATE_LIMIT_PER_HOUR: "lots" }, `
      const { checkToolRateLimit } = require("./lib/rate-limit-middleware.cjs");
      (async () => {
        let last;
        for (let i = 0; i < 101; i++) last = await checkToolRateLimit({ tool: "t", clientIp: "192.0.2.5" });
        console.log(last.allowed ? "allowed" : "refused", last.headers["X-RateLimit-Limit"]);
      })();`);
    assert.equal(out.split("\n").pop(), "refused 100");
  });

  it("a full store refuses new work instead of growing", () => {
    const out = childJs({ STORE_MAX_KEYS: "3" }, `
      const { checkToolRateLimit } = require("./lib/rate-limit-middleware.cjs");
      (async () => {
        const r = [];
        for (let i = 0; i < 5; i++) r.push((await checkToolRateLimit({ tool: "t", clientIp: "198.51.100." + i })).statusCode || 200);
        console.log(r.join(","));
      })();`);
    assert.equal(out.split("\n").pop(), "200,200,200,503,503");
  });
});

// ---------------------------------------------------------------------------
// Through the real HTTP server: SSE session, then tools/call messages.
// ---------------------------------------------------------------------------

// 132.119: every spawned server is torn down whatever happens to the test.
// Each binds a free port (PORT=0) on loopback and reports the port it got;
// readiness, the SSE handshake and each POST have a bound, so a failure is a
// failure, not a hang; and the children are killed in afterEach, after, and
// on process exit, so a failing or cancelled run leaves no node server.js.
const STEP_MS = 10000;
const live = new Set();

function killNow(child) {
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

async function stopServer(child) {
  live.delete(child);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  const t = setTimeout(() => killNow(child), 2000);
  await gone;
  clearTimeout(t);
}

const openReqs = new Set();

async function stopAll() {
  for (const r of openReqs) r.destroy();
  openReqs.clear();
  await Promise.all([...live].map(stopServer));
}

// File level, so they cover every test in this file, failing ones included.
afterEach(stopAll);
after(stopAll);

process.on("exit", () => { for (const c of live) killNow(c); });
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, () => { for (const c of live) killNow(c); process.exit(130); });
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, PORT: "0", BIND_HOST: "127.0.0.1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    live.add(child);
    let out = "";
    let done = false;
    const fail = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stopServer(child).then(() => reject(err));
    };
    const timer = setTimeout(() => fail(new Error(`server not ready in ${STEP_MS}ms: ${out}`)), STEP_MS);
    const onData = (d) => {
      out += d;
      const m = out.match(/listening on http:\/\/[^:\s]+:(\d+)/);
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.stdout.resume();
        resolve({ child, port: Number(m[1]) });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (d) => { out += d; });
    child.on("error", fail);
    child.on("exit", (code, sig) => fail(new Error(`server exited ${code ?? sig}: ${out}`)));
  });
}

function openSession(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/mcp/sse", agent: false }, (res) => {
      if (res.statusCode !== 200) { resolve({ status: res.statusCode, req }); res.resume(); return; }
      let buf = "";
      res.on("data", (d) => {
        buf += d;
        const m = buf.match(/sessionId=([0-9a-f-]+)/);
        if (m) { req.setTimeout(0); resolve({ status: 200, sessionId: m[1], req }); }
      });
    });
    openReqs.add(req);
    req.on("close", () => openReqs.delete(req));
    req.setTimeout(STEP_MS, () => req.destroy(new Error(`no SSE session in ${STEP_MS}ms`)));
    req.on("error", reject);
  });
}

function post(port, sessionId, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port, method: "POST", agent: false,
      path: `/mcp/messages?sessionId=${sessionId}`,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Connection: "close" },
    }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.setTimeout(STEP_MS, () => req.destroy(new Error(`POST got no answer in ${STEP_MS}ms`)));
    req.on("error", reject);
    req.end(data);
  });
}

const call = (id, name) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { query: "let" } } });

describe("HTTP server", { timeout: 60000 }, () => {
  it("refuses the tool call past RATE_LIMIT_PER_HOUR with 429", async () => {
    const { port } = await startServer({ RATE_LIMIT_PER_HOUR: "2" });
    const session = await openSession(port);
    assert.equal(session.status, 200);
    const codes = [];
    for (let i = 1; i <= 3; i++) codes.push(await post(port, session.sessionId, call(i, "toke_spec_lookup")));
    assert.deepEqual(codes, [202, 202, 429]);
  });

  it("refuses tool calls with 503 once the store is full, instead of allowing them", async () => {
    // The first SSE session's bookkeeping fills a 2-key store; the next
    // tools/call needs a new bucket, cannot get one, and is refused.
    const { port } = await startServer({ STORE_MAX_KEYS: "2" });
    const session = await openSession(port);
    assert.equal(session.status, 200);
    assert.equal(await post(port, session.sessionId, call(1, "toke_spec_lookup")), 503);
  });
});
