// 132.72: the in-process store behind the rate limiter and connection
// registry. Before this story the store lacked every sorted-set, hash and
// multi() call they make, so both "failed open" and nothing was ever limited.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const redis = require("../lib/redis-client.cjs");
const { checkRateLimit } = require("../lib/rate-limiter.cjs");
const {
  registerConnection,
  unregisterConnection,
  getConnectionCount,
} = require("../lib/connection-registry.cjs");
const { checkToolRateLimit, checkConnectionLimit } = require("../lib/rate-limit-middleware.cjs");

beforeEach(async () => { await redis.disconnect(); });

describe("rate limiter", () => {
  it("allows up to the limit, then refuses with a retry-after", async () => {
    const a = await checkRateLimit("t:k", 2, 60);
    const b = await checkRateLimit("t:k", 2, 60);
    const c = await checkRateLimit("t:k", 2, 60);
    assert.deepEqual([a.allowed, b.allowed, c.allowed], [true, true, false]);
    assert.equal(b.remaining, 0);
    assert.ok(c.retryAfter >= 1 && c.retryAfter <= 60, `retryAfter ${c.retryAfter}`);
  });

  it("does not count a refused request against the window", async () => {
    await checkRateLimit("t:r", 1, 60);
    await checkRateLimit("t:r", 1, 60);
    const client = await redis.getClient();
    assert.equal(await client.zCard("t:r"), 1);
  });

  it("keeps separate keys separate", async () => {
    await checkRateLimit("t:x", 1, 60);
    assert.equal((await checkRateLimit("t:y", 1, 60)).allowed, true);
  });

  it("middleware answers 429 once a tool's limit is spent", async () => {
    const cfg = { limit: 1, windowSec: 60 };
    const ok = await checkToolRateLimit({ tool: "toke_check", clientIp: "1.2.3.4", config: cfg });
    const no = await checkToolRateLimit({ tool: "toke_check", clientIp: "1.2.3.4", config: cfg });
    assert.equal(ok.allowed, true);
    assert.equal(no.allowed, false);
    assert.equal(no.statusCode, 429);
    assert.ok(no.headers["Retry-After"]);
  });
});

describe("connection registry", () => {
  it("counts registered connections per IP and forgets unregistered ones", async () => {
    await registerConnection("s1", { ip: "9.9.9.9" });
    await registerConnection("s2", { ip: "9.9.9.9" });
    await registerConnection("s3", { ip: "8.8.8.8" });
    assert.equal(await getConnectionCount("9.9.9.9"), 2);
    await unregisterConnection("s1");
    assert.equal(await getConnectionCount("9.9.9.9"), 1);
    assert.equal(await getConnectionCount("8.8.8.8"), 1);
  });

  it("connection limit refuses the connection past maxConnections", async () => {
    await registerConnection("c1", { ip: "7.7.7.7" });
    await registerConnection("c2", { ip: "7.7.7.7" });
    const r = await checkConnectionLimit({ clientIp: "7.7.7.7", config: { maxConnections: 2 } });
    assert.equal(r.allowed, false);
    assert.equal(r.statusCode, 429);
  });
});
