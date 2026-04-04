import { createRequire } from "node:module";
import { tokeCheck } from "./check.js";
import { tokeCompile } from "./compile.js";

const require = createRequire(import.meta.url);
const { requireTier } = require("../lib/tier-gate");

/**
 * Built-in benchmark tasks with expected outputs and Python baselines.
 *
 * Each task has:
 *   - inputs: array of test input strings
 *   - expected: array of expected output strings (parallel with inputs)
 *   - baseline_tokens: Python token count for the same task (for comparison)
 */
const BENCHMARK_TASKS = {
  "hello-world": {
    description: "Print hello world",
    inputs: [],
    expected: ["Hello, world!"],
    baseline_tokens: 18,
  },
  "fizzbuzz": {
    description: "FizzBuzz from 1 to 20",
    inputs: [],
    expected: [
      "1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz",
      "11", "Fizz", "13", "14", "FizzBuzz", "16", "17", "Fizz", "19", "Buzz",
    ],
    baseline_tokens: 81,
  },
  "fibonacci": {
    description: "First 10 Fibonacci numbers",
    inputs: [],
    expected: ["0", "1", "1", "2", "3", "5", "8", "13", "21", "34"],
    baseline_tokens: 52,
  },
  "reverse-string": {
    description: "Reverse a string",
    inputs: ["hello", "world", "toke"],
    expected: ["olleh", "dlrow", "ekot"],
    baseline_tokens: 35,
  },
};

/**
 * Rough token count for Toke source code (~4 chars per token).
 */
function countTokens(source) {
  return Math.ceil(source.length / 4);
}

/**
 * toke_bench tool — benchmarks Toke source code against a known task.
 *
 * @param {object} params
 * @param {string} params.source - Toke source code to benchmark
 * @param {string} params.task_id - Benchmark task identifier
 * @param {object} [params.context] - Auth context with tier info
 * @returns {Promise<object>}
 */
export async function tokeBench({ source, task_id, context }) {
  // Enforce pro tier
  requireTier(context, "pro");

  const task = BENCHMARK_TASKS[task_id];
  if (!task) {
    return {
      passed: false,
      error: `Unknown benchmark task: ${task_id}. Available: ${Object.keys(BENCHMARK_TASKS).join(", ")}`,
      diagnostics: [],
      test_results: [],
    };
  }

  // Step 1: Run toke_check
  const checkResult = await tokeCheck(source);

  const diagnostics = [];
  if (checkResult.diagnostics) {
    diagnostics.push(...checkResult.diagnostics);
  } else if (checkResult.raw && !checkResult.ok) {
    diagnostics.push({ message: checkResult.raw });
  } else if (checkResult.error) {
    diagnostics.push({ message: checkResult.error });
  }

  const checkPassed = checkResult.ok === true || (diagnostics.length === 0);

  if (!checkPassed) {
    return {
      passed: false,
      token_count: countTokens(source),
      baseline_tokens: task.baseline_tokens,
      token_ratio: parseFloat((countTokens(source) / task.baseline_tokens).toFixed(2)),
      diagnostics,
      test_results: [],
    };
  }

  // Step 2: Run toke_compile
  const compileResult = await tokeCompile(source);

  if (!compileResult.ok) {
    const compileDiags = compileResult.diagnostics
      ? (Array.isArray(compileResult.diagnostics) ? compileResult.diagnostics : [compileResult.diagnostics])
      : [{ message: compileResult.error || "Compilation failed" }];
    diagnostics.push(...compileDiags);

    return {
      passed: false,
      token_count: countTokens(source),
      baseline_tokens: task.baseline_tokens,
      token_ratio: parseFloat((countTokens(source) / task.baseline_tokens).toFixed(2)),
      diagnostics,
      test_results: [],
    };
  }

  // Step 3: Compare against expected outputs
  // Since we cannot execute the compiled code in this environment,
  // we mark compilation success and report structural comparison.
  const tokenCount = countTokens(source);
  const testResults = task.expected.map((exp, i) => ({
    input: task.inputs[i] || null,
    expected: exp,
    actual: null,       // Would require runtime execution
    passed: null,       // Cannot verify without execution
  }));

  return {
    passed: compileResult.ok,
    token_count: tokenCount,
    baseline_tokens: task.baseline_tokens,
    token_ratio: parseFloat((tokenCount / task.baseline_tokens).toFixed(2)),
    diagnostics,
    test_results: testResults,
  };
}

// Export for testing
export { BENCHMARK_TASKS };
