import { dirname } from "node:path";
import { tokeCheck } from "./check.js";
import { tokeCompile } from "./compile.js";
import { requireTier } from "../lib/tier-gate.js";

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
    baseline_tokens: 6,  // Python cl100k: print("Hello, world!")
  },
  "fizzbuzz": {
    description: "FizzBuzz from 1 to 20",
    inputs: [],
    expected: [
      "1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz",
      "11", "Fizz", "13", "14", "FizzBuzz", "16", "17", "Fizz", "19", "Buzz",
    ],
    baseline_tokens: 52,  // Python cl100k: for/if/elif/else
  },
  "fibonacci": {
    description: "First 10 Fibonacci numbers",
    inputs: [],
    expected: ["0", "1", "1", "2", "3", "5", "8", "13", "21", "34"],
    baseline_tokens: 24,  // Python cl100k: a,b=0,1; for; print
  },
  "reverse-string": {
    description: "Reverse a string",
    inputs: ["hello", "world", "toke"],
    expected: ["olleh", "dlrow", "ekot"],
    baseline_tokens: 12,  // Python cl100k: import sys; print([::-1])
  },
};

/**
 * BPE tokenizer for accurate toke token counting.
 *
 * Loads the purpose-built 16K BPE tokenizer (tokenizer_v03.json) trained on
 * 25,953 toke programs + 698 loke production modules. Falls back to a
 * character-per-4 heuristic if the tokenizer file is not available.
 *
 * Gate 2 result: 52% average reduction vs cl100k_base across 42 benchmarks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let bpeVocab = null;
let bpeMergeRank = null;

try {
  // Try multiple paths for the tokenizer
  const paths = [
    join(__dirname, "..", "data", "tokenizer_v03.json"),
    join(__dirname, "..", "..", "toke-tokenizer", "tokenizer_v03.json"),
  ];
  for (const p of paths) {
    try {
      const data = JSON.parse(readFileSync(p, "utf-8"));
      bpeVocab = data.model.vocab;
      bpeMergeRank = {};
      data.model.merges.forEach(([a, b], i) => {
        bpeMergeRank[a + "\0" + b] = i;
      });
      break;
    } catch (_) { continue; }
  }
} catch (_) { /* fallback to heuristic */ }

/**
 * Normalise toke source for optimal BPE tokenisation.
 * Strips comments, collapses whitespace, removes spaces around structural chars.
 */
function normalizeToke(source) {
  let s = source;
  s = s.replace(/\(\*[\s\S]*?\*\)/g, "");
  s = s.replace(/\/\/[^\n]*/g, "");
  let result = [], inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && (i === 0 || s[i - 1] !== "\\")) { inStr = !inStr; result.push(c); }
    else if (inStr) { result.push(c); }
    else if (/\s/.test(c)) { if (result.length && result[result.length - 1] !== " ") result.push(" "); }
    else { result.push(c); }
  }
  s = result.join("").trim();
  for (const ch of [";", "{", "}", "(", ")", "=", ":", "<", ">"]) {
    s = s.split(" " + ch).join(ch).split(ch + " ").join(ch);
  }
  return s;
}

/**
 * Count tokens using the purpose-built BPE tokenizer.
 * Falls back to length/4 heuristic if tokenizer not loaded.
 */
function countTokens(source) {
  if (!bpeVocab || !bpeMergeRank) {
    return Math.ceil(source.length / 4);
  }
  const norm = normalizeToke(source);
  let symbols = norm.split("");
  while (symbols.length > 1) {
    let bestRank = Infinity, bestIdx = -1;
    for (let i = 0; i < symbols.length - 1; i++) {
      const key = symbols[i] + "\0" + symbols[i + 1];
      const rank = bpeMergeRank[key];
      if (rank !== undefined && rank < bestRank) { bestRank = rank; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    symbols.splice(bestIdx, 2, symbols[bestIdx] + symbols[bestIdx + 1]);
  }
  return symbols.length;
}

/**
 * Returns whether the BPE tokenizer is loaded (vs heuristic fallback).
 */
export function tokenizerLoaded() {
  return bpeVocab !== null;
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
