// 132.81: tools/check.js and tools/compile.js must return every diagnostic
// tkc emits — none, one, or many.
//
// tkc writes diagnostics as JSON Lines (one object per line) on stderr, and
// leaves stdout empty for --check. Before 132.81 check.js JSON.parse()d the
// whole stream: a lone diagnostic came back as a bare object with no `ok` and
// no `diagnostics`, and two or more came back as an unparsed string.
//
// Two layers:
//   1. Replay: test/fixtures/tkc-3.0.0/*.stderr is real `tkc --check
//      --diag-json` output, captured from toke 3.0.0 on 2026-09-24 (run in
//      that directory, so "file" is relative). These run everywhere.
//   2. Live: the same sources through a real tkc, when one is found
//      (TOKE_TKC, else ~/tk/toke/toke, else `tkc` on PATH). Skipped, and says
//      so, when none is.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tkc-3.0.0");
const src = (name) => readFileSync(join(FIX, `${name}.tk`), "utf-8");

function findRealTkc() {
  const candidates = [process.env.TOKE_TKC, join(homedir(), "tk", "toke", "toke"), "tkc"].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {
      // not this one
    }
  }
  return null;
}
const REAL_TKC = findRealTkc();

// One stub for the whole process (TKC_PATH is read when check.js loads). It
// replays a fixture, or execs the real tkc, as `mode` says.
const dir = mkdtempSync(join(tmpdir(), "toke-mcp-check-"));
const modeFile = join(dir, "mode");
const stub = join(dir, "tkc");
writeFileSync(
  stub,
  `#!/bin/sh
mode="$(cat '${modeFile}')"
case "$mode" in
  real) exec '${REAL_TKC ?? "/nonexistent"}' "$@" ;;
  ok) exit 0 ;;
  *) cat '${FIX}/'"$mode"'.stderr' >&2
     case "$mode" in warn) exit 0 ;; *) exit 1 ;; esac ;;
esac
`
);
chmodSync(stub, 0o755);
process.env.TKC_PATH = stub;
delete process.env.TOKE_TELEMETRY;

let tokeCheck, tokeCompile, parseTkcDiagnostics;
before(async () => {
  ({ tokeCheck } = await import("../tools/check.js"));
  ({ tokeCompile } = await import("../tools/compile.js"));
  ({ parseTkcDiagnostics } = await import("../lib/tkc-diagnostics.js"));
});
const mode = (m) => writeFileSync(modeFile, m);
beforeEach(() => mode("ok"));

const codes = (r) => r.diagnostics.map((d) => d.error_code);

// What tkc 3.0.0 says about each fixture source.
const EXPECT = {
  ok: { ok: true, exitCode: 0, codes: [] },
  warn: { ok: true, exitCode: 0, codes: ["W1020", "W1020", "W1020", "W1020"] },
  one: { ok: false, exitCode: 1, codes: ["E4031"] },
  two: { ok: false, exitCode: 1, codes: ["E3011", "E3011"] },
};

describe("parseTkcDiagnostics", () => {
  it("returns every JSON line, in order, and keeps non-JSON text apart", () => {
    const two = readFileSync(join(FIX, "two.stderr"), "utf-8");
    const r = parseTkcDiagnostics(`${two}note: not json\n`, "");
    assert.deepEqual(r.diagnostics.map((d) => d.diagnostic_id), ["D0001", "D0002"]);
    assert.equal(r.raw, "note: not json");
  });

  it("returns nothing for empty streams", () => {
    assert.deepEqual(parseTkcDiagnostics("", undefined), { diagnostics: [], raw: "" });
  });
});

describe("toke_check against recorded tkc 3.0.0 output", () => {
  for (const [name, want] of Object.entries(EXPECT)) {
    it(`${name}: ok=${want.ok}, ${want.codes.length} diagnostic(s)`, async () => {
      mode(name);
      const r = await tokeCheck(src(name));
      assert.equal(r.ok, want.ok);
      assert.equal(r.exitCode, want.exitCode);
      assert.ok(Array.isArray(r.diagnostics), "diagnostics must be an array");
      assert.deepEqual(codes(r), want.codes);
      assert.equal(r.raw, undefined);
      for (const d of r.diagnostics) assert.equal(d.schema_version, "1.0");
    });
  }

  it("a failing exit with no JSON is not ok, and its text is kept as raw", async () => {
    mode("no-such-fixture"); // cat fails: a non-JSON line on stderr, exit 1
    const r = await tokeCheck("m=s;");
    assert.equal(r.ok, false);
    assert.deepEqual(r.diagnostics, []);
    assert.match(r.raw, /no-such-fixture/);
  });
});

describe("toke_compile against recorded tkc 3.0.0 output", () => {
  for (const name of ["one", "two"]) {
    it(`${name}: every diagnostic, as an array`, async () => {
      mode(name);
      const r = await tokeCompile(src(name));
      assert.equal(r.ok, false);
      assert.deepEqual(codes(r), EXPECT[name].codes);
    });
  }
});

describe("toke_check against a real tkc", { skip: REAL_TKC ? false : "no tkc found (set TOKE_TKC)" }, () => {
  for (const [name, want] of Object.entries(EXPECT)) {
    it(`${name}: ok=${want.ok}, ${want.codes.length} diagnostic(s)`, async () => {
      mode("real");
      const r = await tokeCheck(src(name));
      assert.equal(r.ok, want.ok);
      assert.deepEqual(codes(r), want.codes);
    });
  }

  it("toke_compile: two diagnostics from --emit-llvm", async () => {
    mode("real");
    const r = await tokeCompile(src("two"));
    assert.equal(r.ok, false);
    assert.deepEqual(codes(r), EXPECT.two.codes);
  });
});
