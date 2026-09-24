// 132.81: the check and compile Lambdas read tkc's diagnostics the same way
// tools/check.js must — every JSON line on stderr. Before 132.81 both read
// stdout only (tkc leaves it empty), so every diagnostic was dropped.
//
// Replays real tkc 3.0.0 output from test/fixtures/tkc-3.0.0 (see
// test_check.js); no network, no real compiler.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire, Module } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "fixtures", "tkc-3.0.0");
const src = (name) => readFileSync(join(FIX, `${name}.tk`), "utf-8");

const dir = mkdtempSync(join(tmpdir(), "toke-mcp-lambda-"));
const modeFile = join(dir, "mode");
const stub = join(dir, "tkc");
writeFileSync(
  stub,
  `#!/bin/sh
mode="$(cat '${modeFile}')"
[ "$mode" = ok ] && exit 0
cat '${FIX}/'"$mode"'.stderr' >&2
[ "$mode" = warn ] && exit 0
exit 1
`
);
chmodSync(stub, 0o755);
process.env.TKC_PATH = stub;

// The Lambdas are CommonJS, deployed on their own; inside this "type":
// "module" package `require` would load them as ESM and fail. Compile each
// one as CommonJS, as the Lambda runtime does.
function loadLambda(rel) {
  const filename = join(here, "..", rel);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = [];
  m.require = createRequire(filename);
  m._compile(readFileSync(filename, "utf-8"), filename);
  return m.exports;
}
const check = loadLambda("lambda/check/index.js");
const compile = loadLambda("lambda/compile/index.js");
const mode = (m) => writeFileSync(modeFile, m);
beforeEach(() => mode("ok"));
const body = (r) => JSON.parse(r.body);
const codes = (b) => b.diagnostics.map((d) => d.error_code);

const EXPECT = {
  ok: { ok: true, codes: [] },
  warn: { ok: true, codes: ["W1020", "W1020", "W1020", "W1020"] },
  one: { ok: false, codes: ["E4031"] },
  two: { ok: false, codes: ["E3011", "E3011"] },
};

describe("lambda/check", () => {
  for (const [name, want] of Object.entries(EXPECT)) {
    it(`${name}: ok=${want.ok}, ${want.codes.length} diagnostic(s)`, async () => {
      mode(name);
      const b = body(await check.handler({ source: src(name) }));
      assert.equal(b.ok, want.ok);
      assert.deepEqual(codes(b), want.codes);
    });
  }
});

describe("lambda/compile", () => {
  for (const name of ["one", "two"]) {
    it(`${name}: returns every diagnostic`, async () => {
      mode(name);
      const b = body(await compile.handler({ source: src(name) }));
      assert.equal(b.ok, false);
      assert.deepEqual(codes(b), EXPECT[name].codes);
    });
  }
});
