// toke 121.43 (9): what the server registers is what the docs say it
// registers, and toke_compress does not advertise a tkc option that does not
// exist.
//
//   - README.md said "14 tools" in three places while server.js registered
//     15 (toke_feedback was in neither README's table nor TOOLS.md's);
//   - toke_compress spliced each preserve_atoms entry into tkc's argv as
//     `--preserve-atom <p>`, a flag tkc has never had (`tkc: unknown flag:
//     --preserve-atom`, exit 3), so every call that used the field spawned
//     tkc and failed with a usage error.  It is now refused before tkc runs.
//
// Negative control: on toke-mcp main 937eb18 the count test fails (README
// says 14, the server lists 15; toke_feedback undocumented) and the
// preserve_atoms test fails (the stub tkc ran).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// A stub tkc that records that it ran and prints a compress result.
const dir = mkdtempSync(join(tmpdir(), "toke-mcp-surface-"));
const RAN = join(dir, "ran");
const stub = join(dir, "tkc");
writeFileSync(
  stub,
  `#!/bin/sh
echo "$@" >> '${RAN}'
echo '{"compressed":"x","original_tokens":4,"compressed_tokens":1}'
exit 0
`
);
chmodSync(stub, 0o755);
process.env.TKC_PATH = stub;
delete process.env.TOKE_TELEMETRY;

let createMcpServer, Client, InMemoryTransport;
before(async () => {
  ({ createMcpServer } = await import("../server.js"));
  ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
  ({ InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js"));
});

async function connect() {
  const server = createMcpServer();
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("registered tools match the documentation", () => {
  it("README's tool count, README's table and TOOLS.md name every registered tool", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
    const toolsMd = readFileSync(join(ROOT, "TOOLS.md"), "utf-8");
    const counts = [...readme.matchAll(/\b(\d+) (?:MCP )?tools\b/g)].map((m) => Number(m[1]));
    assert.ok(counts.length >= 1, "README states a tool count");
    for (const c of counts) assert.equal(c, names.length, `README says ${c} tools; the server registers ${names.length}`);
    for (const n of names) {
      assert.ok(readme.includes("`" + n + "`"), `${n} is registered but not in README.md`);
      assert.ok(new RegExp("(`|### )" + n + "\\b").test(toolsMd), `${n} is registered but not in TOOLS.md`);
    }
  });
});

describe("toke_compress preserve_atoms (tkc has no --preserve-atom)", () => {
  const call = async (args) => {
    const client = await connect();
    const r = await client.callTool({ name: "toke_compress", arguments: args });
    return JSON.parse(r.content[0].text);
  };

  it("a non-empty preserve_atoms is refused before tkc runs, and says why", async () => {
    const r = await call({ input: "hello", preserve_atoms: ["\\$[A-Z]+"] });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.error, /preserve_atoms is not supported/);
    assert.equal(existsSync(RAN), false, "tkc must not have run");
  });

  it("control: without preserve_atoms (or with []) tkc runs with no --preserve-atom", async () => {
    const r1 = await call({ input: "hello" });
    const r2 = await call({ input: "hello", preserve_atoms: [] });
    assert.equal(r1.compressed, "x", JSON.stringify(r1));
    assert.equal(r2.compressed, "x", JSON.stringify(r2));
    const argv = readFileSync(RAN, "utf-8");
    assert.equal(argv.trim().split("\n").length, 2);
    assert.ok(!argv.includes("--preserve-atom"), argv);
  });
});
