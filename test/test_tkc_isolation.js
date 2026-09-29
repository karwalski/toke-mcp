// 121.26 (audit 120.15 TOK-02, TOK-03): what an MCP client can make the
// server do with tkc is bounded.
//
//   - at most TKC_MAX_CONCURRENT tkc processes run at once, at most
//     TKC_MAX_QUEUE more wait, and past that a call is refused (EBUSY);
//   - TKC_MEMORY_LIMIT_MB runs tkc under `ulimit -v`, and where the limit
//     cannot be applied the call fails instead of running unlimited;
//   - source/input longer than TOOL_MAX_SOURCE_CHARS is refused by the tool
//     schema before anything is written or run (the Lambda handlers had a
//     64 KB cap; the SSE/stdio handlers had none);
//   - a preserve_atoms entry may not start with '-' (it is spliced into
//     tkc's argv), and there are at most 32 of them.
//
// Before 121.26 every tool call was a bare execFile with a timeout: five
// concurrent toke_check calls ran five tkc processes, however many came.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";

// A stub tkc that records how many copies of itself are running at once:
// each run drops a file in RUN, lists RUN into PEAK, sleeps, and leaves.
const dir = mkdtempSync(join(tmpdir(), "toke-mcp-iso-"));
const RUN = join(dir, "run");
const PEAK = join(dir, "peak");
const stub = join(dir, "tkc");
writeFileSync(
  stub,
  `#!/bin/sh
mkdir -p '${RUN}' '${PEAK}'
me="$$"
: > '${RUN}'/"$me"
ls '${RUN}' | wc -l | tr -d ' ' > '${PEAK}'/"$me"
case "$1" in
  --ulimit) ulimit -v; rm -f '${RUN}'/"$me"; exit 0 ;;
esac
sleep 0.4
rm -f '${RUN}'/"$me"
exit 0
`
);
chmodSync(stub, 0o755);
process.env.TKC_PATH = stub;
process.env.TKC_MAX_CONCURRENT = "2";
process.env.TKC_MAX_QUEUE = "100";
delete process.env.TOKE_TELEMETRY;

const peak = () => Math.max(0, ...readdirSync(PEAK).map((f) => Number(readFileSync(join(PEAK, f), "utf-8"))));
let tokeCheck, createMcpServer, Client, InMemoryTransport;
before(async () => {
  ({ tokeCheck } = await import("../tools/check.js"));
  ({ createMcpServer } = await import("../server.js"));
  ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
  ({ InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js"));
});

describe("tkc concurrency (TOK-02)", () => {
  it("six concurrent toke_check calls never run more than TKC_MAX_CONCURRENT=2 tkc at once", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => tokeCheck("m=s;")));
    assert.equal(results.length, 6);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.ok)));
    assert.equal(peak(), 2, `peak concurrent tkc: ${peak()}`);
  });

  it("past TKC_MAX_QUEUE a call is refused, not queued", async () => {
    const { execTkc } = await import("../lib/run-tkc.js");
    process.env.TKC_MAX_CONCURRENT = "1";
    process.env.TKC_MAX_QUEUE = "1";
    try {
      const settled = await Promise.allSettled([
        execTkc(stub, ["a"]), execTkc(stub, ["b"]), execTkc(stub, ["c"]),
      ]);
      assert.deepEqual(settled.map((s) => s.status), ["fulfilled", "fulfilled", "rejected"]);
      assert.equal(settled[2].reason.code, "EBUSY");
    } finally {
      process.env.TKC_MAX_CONCURRENT = "2";
      process.env.TKC_MAX_QUEUE = "100";
    }
  });
});

describe("tkc memory limit (TOK-02)", () => {
  it("TKC_MEMORY_LIMIT_MB is applied, or the call fails -- never runs unlimited", async () => {
    const { execTkc } = await import("../lib/run-tkc.js");
    process.env.TKC_MEMORY_LIMIT_MB = "512";
    try {
      const r = await execTkc(stub, ["--ulimit"]).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
      if (platform() === "linux") {
        assert.ok(r.ok, r.e && r.e.message);
        assert.equal(r.v.stdout.trim(), String(512 * 1024));
      } else if (r.ok) {
        assert.equal(r.v.stdout.trim(), String(512 * 1024), "applied");
      } else {
        assert.equal(r.e.code, 125, `refused with 125, got ${r.e.code}`);
      }
    } finally {
      delete process.env.TKC_MEMORY_LIMIT_MB;
    }
  });
});

describe("tool input bounds (TOK-02, TOK-03)", () => {
  async function connect() {
    const server = createMcpServer();
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }
  // A schema refusal arrives as an error result or a thrown McpError,
  // depending on the SDK version; either counts.
  const call = (client, name, args) =>
    client.callTool({ name, arguments: args }).catch((e) => ({ isError: true, content: [{ text: String(e && e.message) }] }));
  const refused = (r) => r.isError === true && /too_big|at most|65536|start with '-'|too_big/i.test(JSON.stringify(r.content));

  it("toke_check refuses source over 65536 characters before running tkc", async () => {
    const client = await connect();
    const before = readdirSync(PEAK).length;
    const r = await call(client, "toke_check", { source: "x".repeat(65537) });
    assert.ok(refused(r), JSON.stringify(r).slice(0, 300));
    assert.equal(readdirSync(PEAK).length, before, "tkc must not have run");
    const ok = await call(client, "toke_check", { source: "m=s;" });
    assert.notEqual(ok.isError, true, "an ordinary source still runs");
  });

  it("toke_compress refuses a preserve_atoms entry that starts with '-'", async () => {
    const client = await connect();
    const r = await call(client, "toke_compress", { input: "abc", preserve_atoms: ["--out"] });
    assert.ok(refused(r), JSON.stringify(r).slice(0, 300));
  });
});
