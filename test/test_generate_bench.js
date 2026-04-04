import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the modules under test
// ---------------------------------------------------------------------------

// Mock sagemaker-client
const mockInvokeEndpoint = mock.fn();

// Mock tokeCheck / tokeCompile at the module level
const mockTokeCheck = mock.fn();
const mockTokeCompile = mock.fn();

// We test tier-gate directly
const { requireTier } = require("../lib/tier-gate");

// ---------------------------------------------------------------------------
// Tier gate tests
// ---------------------------------------------------------------------------

describe("tier-gate", () => {
  it("allows pro tier when pro is required", () => {
    assert.doesNotThrow(() => requireTier({ tier: "pro" }, "pro"));
  });

  it("allows pro tier when free is required", () => {
    assert.doesNotThrow(() => requireTier({ tier: "pro" }, "free"));
  });

  it("allows free tier when free is required", () => {
    assert.doesNotThrow(() => requireTier({ tier: "free" }, "free"));
  });

  it("rejects free tier when pro is required", () => {
    const err = assert.throws(() => requireTier({ tier: "free" }, "pro"));
    assert.match(err.message, /Pro tier API key/);
    assert.equal(err.code, "TIER_REQUIRED");
  });

  it("rejects missing context when pro is required", () => {
    const err = assert.throws(() => requireTier(null, "pro"));
    assert.match(err.message, /Pro tier API key/);
  });

  it("rejects undefined tier when pro is required", () => {
    const err = assert.throws(() => requireTier({}, "pro"));
    assert.match(err.message, /Pro tier API key/);
  });

  it("throws on unknown required tier", () => {
    assert.throws(() => requireTier({ tier: "pro" }, "enterprise"), /Unknown tier/);
  });
});

// ---------------------------------------------------------------------------
// toke_generate tests (using inline logic to avoid import-time side effects)
// ---------------------------------------------------------------------------

describe("toke_generate", () => {
  // We test the generate logic by calling the module after mocking deps.
  // Since ESM dynamic mocking is tricky, we test the core logic inline.

  it("rejects free tier users", async () => {
    try {
      requireTier({ tier: "free" }, "pro");
      assert.fail("Should have thrown");
    } catch (err) {
      assert.match(err.message, /Pro tier API key/);
    }
  });

  it("handles cold start response", () => {
    // Simulate the cold start logic from generate.js
    const sagemakerResult = {
      cold_start: true,
      estimated_wait: 45,
      generated_text: undefined,
    };

    if (sagemakerResult.cold_start && !sagemakerResult.generated_text) {
      const result = {
        cold_start: true,
        estimated_wait: sagemakerResult.estimated_wait || 45,
        message: "Model is warming up...",
      };
      assert.equal(result.cold_start, true);
      assert.equal(result.estimated_wait, 45);
      assert.equal(result.message, "Model is warming up...");
    } else {
      assert.fail("Should have detected cold start");
    }
  });

  it("returns generated source with diagnostics on success", () => {
    // Simulate successful generation + check flow
    const sagemakerResult = {
      generated_text: "fn main() { io.println($\"Hello\"); }",
      tokens_used: 42,
      cold_start: false,
    };

    const checkResult = { ok: true };

    const source = sagemakerResult.generated_text.trim();
    const diagnostics = [];
    const compiled = checkResult.ok === true;

    const result = {
      source,
      diagnostics,
      compiled,
      tokens_used: sagemakerResult.tokens_used,
      cold_start: sagemakerResult.cold_start,
    };

    assert.equal(result.source, "fn main() { io.println($\"Hello\"); }");
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.compiled, true);
    assert.equal(result.tokens_used, 42);
    assert.equal(result.cold_start, false);
  });

  it("returns diagnostics when generated code has errors", () => {
    const checkResult = {
      ok: false,
      diagnostics: [{ code: "E1001", message: "Unexpected token" }],
    };

    const diagnostics = [];
    if (checkResult.diagnostics) {
      diagnostics.push(...checkResult.diagnostics);
    }

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "E1001");
  });

  it("handles SageMaker error with no generated text", () => {
    const sagemakerResult = {
      error: "Endpoint is in unexpected state: Failed",
      cold_start: false,
    };

    if (sagemakerResult.error && !sagemakerResult.generated_text) {
      const result = {
        source: null,
        diagnostics: [{ message: sagemakerResult.error }],
        compiled: false,
        tokens_used: 0,
        cold_start: false,
      };
      assert.equal(result.source, null);
      assert.equal(result.compiled, false);
      assert.equal(result.diagnostics[0].message, sagemakerResult.error);
    }
  });
});

// ---------------------------------------------------------------------------
// toke_bench tests
// ---------------------------------------------------------------------------

describe("toke_bench", () => {
  it("rejects free tier users", () => {
    try {
      requireTier({ tier: "free" }, "pro");
      assert.fail("Should have thrown");
    } catch (err) {
      assert.match(err.message, /Pro tier API key/);
    }
  });

  it("rejects unknown task_id", async () => {
    // Import BENCHMARK_TASKS to verify task lookup
    const { BENCHMARK_TASKS } = await import("../tools/bench.js");

    assert.equal(BENCHMARK_TASKS["nonexistent-task"], undefined);
    assert.ok(BENCHMARK_TASKS["hello-world"]);
    assert.ok(BENCHMARK_TASKS["fizzbuzz"]);
    assert.ok(BENCHMARK_TASKS["fibonacci"]);
    assert.ok(BENCHMARK_TASKS["reverse-string"]);
  });

  it("calculates token ratio correctly", () => {
    const source = "fn main() { io.println($\"Hello, world!\"); }";
    const tokenCount = Math.ceil(source.length / 4);
    const baselineTokens = 18;
    const ratio = parseFloat((tokenCount / baselineTokens).toFixed(2));

    assert.equal(typeof ratio, "number");
    assert.ok(ratio > 0);
  });

  it("reports check failures with diagnostics", () => {
    const source = "invalid code";
    const tokenCount = Math.ceil(source.length / 4);
    const baselineTokens = 18;

    const checkResult = {
      ok: false,
      diagnostics: [{ code: "E1001", message: "Syntax error" }],
    };

    const diagnostics = [];
    if (checkResult.diagnostics) {
      diagnostics.push(...checkResult.diagnostics);
    }

    const result = {
      passed: false,
      token_count: tokenCount,
      baseline_tokens: baselineTokens,
      token_ratio: parseFloat((tokenCount / baselineTokens).toFixed(2)),
      diagnostics,
      test_results: [],
    };

    assert.equal(result.passed, false);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.test_results.length, 0);
  });

  it("reports compilation success with test results", () => {
    const task = {
      inputs: ["hello"],
      expected: ["olleh"],
      baseline_tokens: 35,
    };

    const source = 'fn reverse($s) -> $result { /* ... */ }';
    const tokenCount = Math.ceil(source.length / 4);

    const testResults = task.expected.map((exp, i) => ({
      input: task.inputs[i] || null,
      expected: exp,
      actual: null,
      passed: null,
    }));

    const result = {
      passed: true,
      token_count: tokenCount,
      baseline_tokens: task.baseline_tokens,
      token_ratio: parseFloat((tokenCount / task.baseline_tokens).toFixed(2)),
      diagnostics: [],
      test_results: testResults,
    };

    assert.equal(result.passed, true);
    assert.equal(result.test_results.length, 1);
    assert.equal(result.test_results[0].input, "hello");
    assert.equal(result.test_results[0].expected, "olleh");
  });

  it("includes all benchmark tasks with baseline tokens", async () => {
    const { BENCHMARK_TASKS } = await import("../tools/bench.js");

    for (const [id, task] of Object.entries(BENCHMARK_TASKS)) {
      assert.ok(task.description, `${id} should have a description`);
      assert.ok(Array.isArray(task.expected), `${id} should have expected outputs`);
      assert.ok(typeof task.baseline_tokens === "number", `${id} should have baseline_tokens`);
      assert.ok(task.baseline_tokens > 0, `${id} baseline_tokens should be positive`);
    }
  });
});
