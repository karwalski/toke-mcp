// 132.76: these tests call tools/generate.js and tools/bench.js. Until this
// story most of them rebuilt the tools' logic inline and asserted on values
// the test itself had constructed, so no change to either tool could turn
// them red.
//
// Nothing here touches the network or a real compiler: `fetch` is replaced
// for the toke API, and TKC_PATH points at a stub that answers the way tkc
// 3.0.0 does (checked by hand on 2026-09-24): `--check --diag-json` prints
// nothing and exits 0 on a clean file, or one JSON diagnostic per line and
// exits 1; `--emit-llvm` prints IR and exits 0.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "toke-mcp-test-"));
const tkcLog = join(dir, "tkc.log");
const tkc = join(dir, "tkc");
const diag = (code, line) =>
  JSON.stringify({ error_code: code, severity: "error", message: `stub ${code}`, pos: { line, col: 1 } });
writeFileSync(
  tkc,
  `#!/bin/sh
f="$(eval echo \\$$#)"
echo "$*" >> '${tkcLog}'
if [ "$1" = "--check" ]; then
  if grep -q TWO_ERR "$f"; then echo '${diag("E2001", 1)}'; echo '${diag("E3011", 2)}'; exit 1; fi
  if grep -q ONE_ERR "$f"; then echo '${diag("E3011", 1)}'; exit 1; fi
  exit 0
fi
if [ "$1" = "--emit-llvm" ]; then
  if grep -q LINK_ERR "$f"; then echo "error: undefined symbol" >&2; exit 1; fi
  if grep -q _ERR "$f"; then echo "error: rejected" >&2; exit 1; fi
  echo "; ModuleID = 'stub'"; exit 0
fi
exit 2
`
);
chmodSync(tkc, 0o755);

// Both are read when the tool modules load, so set them before importing.
process.env.TKC_PATH = tkc;
process.env.TOKE_API_KEY = "test-key";
process.env.TOKE_API_URL = "http://toke-api.invalid";
delete process.env.TOKE_TELEMETRY;

let apiReply;
let requests;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push({ url: String(url), body });
  const r = String(url).endsWith("/v1/generate") ? apiReply : { status: 200, json: {} };
  return { ok: r.status < 400, status: r.status, json: async () => r.json };
};

let tokeGenerate, tokeBench, BENCHMARK_TASKS;
before(async () => {
  ({ tokeGenerate } = await import("../tools/generate.js"));
  ({ tokeBench, BENCHMARK_TASKS } = await import("../tools/bench.js"));
});
beforeEach(() => {
  requests = [];
  writeFileSync(tkcLog, "");
});
const tkcCalls = () => readFileSync(tkcLog, "utf-8").split("\n").filter(Boolean).map((l) => l.split(" ")[0]);

// A known defect, filed with 132.76's report: tools/check.js JSON.parse()s
// tkc's whole stdout, which succeeds only when there is exactly one
// diagnostic, and then returns that diagnostic bare - no `diagnostics` array,
// no `ok`. generate.js and bench.js both read that as "no diagnostics".
// bench.js is saved by its compile step; generate.js has none and reports the
// rejected program as compiled (reproduced with the real tkc 3.0.0). The
// `todo` test below states the correct behaviour; it runs and fails visibly
// without failing the suite.
const SINGLE_DIAG_DEFECT = "tools/check.js drops a lone diagnostic (filed with 132.76)";

describe("toke_generate", () => {
  it("returns the API's error as a diagnostic and never runs tkc", async () => {
    apiReply = { status: 503, json: { error: "Endpoint is in unexpected state: Failed" } };
    const r = await tokeGenerate({ description: "add two numbers" });
    assert.deepEqual(r, {
      source: null,
      diagnostics: [{ message: "Endpoint is in unexpected state: Failed" }],
      compiled: false,
      tokens_in: 0,
      tokens_out: 0,
      toke_bpe_out: 0,
    });
    assert.deepEqual(tkcCalls(), []);
  });

  it("trims clean generated source, checks it, and passes the token counts through", async () => {
    apiReply = { status: 200, json: { source: "  m=s;f=main():i64{<0};\n", tokens_in: 11, tokens_out: 22, toke_bpe_out: 17 } };
    const r = await tokeGenerate({ description: "return zero" });
    assert.deepEqual(r, {
      source: "m=s;f=main():i64{<0};",
      diagnostics: [],
      compiled: true,
      tokens_in: 11,
      tokens_out: 22,
      toke_bpe_out: 17,
    });
    assert.deepEqual(tkcCalls(), ["--check"]);
    const fb = requests.find((q) => q.url.endsWith("/v1/feedback"));
    assert.equal(fb.body.compiles, true);
    assert.equal(fb.body.prompt, "return zero");
  });

  it("sends the difficulty hint with the description", async () => {
    apiReply = { status: 200, json: { source: "m=s;" } };
    await tokeGenerate({ description: "sort a list", difficulty: "hard", max_tokens: 99 });
    const g = requests.find((q) => q.url === "http://toke-api.invalid/v1/generate");
    assert.equal(g.body.description, "sort a list\nDifficulty level: hard.");
    assert.equal(g.body.max_tokens, 99);
  });

  it("reports a program tkc rejects as not compiled", async () => {
    apiReply = { status: 200, json: { source: "TWO_ERR" } };
    const r = await tokeGenerate({ description: "x" });
    assert.equal(r.compiled, false);
    assert.ok(r.diagnostics.length > 0);
    const fb = requests.find((q) => q.url.endsWith("/v1/feedback"));
    assert.equal(fb.body.compiles, false);
  });

  it("reports a program with exactly one diagnostic as not compiled", { todo: SINGLE_DIAG_DEFECT }, async () => {
    apiReply = { status: 200, json: { source: "ONE_ERR" } };
    const r = await tokeGenerate({ description: "x" });
    assert.equal(r.compiled, false);
  });
});

describe("toke_bench", () => {
  const ratio = (r) => parseFloat((r.token_count / r.baseline_tokens).toFixed(2));

  it("rejects an unknown task_id, naming the known ones, without running tkc", async () => {
    const r = await tokeBench({ source: "m=s;", task_id: "nonexistent-task" });
    assert.equal(r.passed, false);
    assert.equal(
      r.error,
      "Unknown benchmark task: nonexistent-task. Available: hello-world, fizzbuzz, fibonacci, reverse-string",
    );
    assert.deepEqual(tkcCalls(), []);
  });

  it("stops at a failed check: no compile, no test results", async () => {
    const r = await tokeBench({ source: "TWO_ERR", task_id: "fibonacci" });
    assert.equal(r.passed, false);
    assert.ok(r.diagnostics.length > 0);
    assert.deepEqual(r.test_results, []);
    assert.equal(r.baseline_tokens, BENCHMARK_TASKS.fibonacci.baseline_tokens);
    assert.ok(r.token_count > 0);
    assert.equal(r.token_ratio, ratio(r));
    assert.deepEqual(tkcCalls(), ["--check"]);
  });

  it("reports a compile failure after a clean check", async () => {
    const r = await tokeBench({ source: "m=s; LINK_ERR", task_id: "hello-world" });
    assert.equal(r.passed, false);
    assert.deepEqual(r.diagnostics, [{ message: "error: undefined symbol" }]);
    assert.deepEqual(r.test_results, []);
    assert.deepEqual(tkcCalls(), ["--check", "--emit-llvm"]);
  });

  it("passes a program that checks and compiles, with one unexecuted result per expected output", async () => {
    const r = await tokeBench({ source: "m=s;f=main():i64{<0};", task_id: "reverse-string" });
    assert.equal(r.passed, true);
    assert.deepEqual(r.diagnostics, []);
    assert.deepEqual(r.test_results, [
      { input: "hello", expected: "olleh", actual: null, passed: null },
      { input: "world", expected: "dlrow", actual: null, passed: null },
      { input: "toke", expected: "ekot", actual: null, passed: null },
    ]);
    assert.equal(r.baseline_tokens, 12);
    assert.equal(r.token_ratio, ratio(r));
    assert.deepEqual(tkcCalls(), ["--check", "--emit-llvm"]);
  });

  it("does not pass a program with exactly one diagnostic", async () => {
    // The check step loses the diagnostic (see SINGLE_DIAG_DEFECT); the
    // compile step is what fails it, as it does with tkc 3.0.0.
    const r = await tokeBench({ source: "ONE_ERR", task_id: "hello-world" });
    assert.equal(r.passed, false);
    assert.deepEqual(tkcCalls(), ["--check", "--emit-llvm"]);
  });

  it("every benchmark task has a description, expected outputs and a positive baseline", () => {
    for (const [id, task] of Object.entries(BENCHMARK_TASKS)) {
      assert.ok(task.description, `${id} should have a description`);
      assert.ok(Array.isArray(task.expected) && task.expected.length > 0, `${id} should have expected outputs`);
      assert.ok(Number.isInteger(task.baseline_tokens) && task.baseline_tokens > 0, `${id} baseline_tokens`);
    }
  });
});
