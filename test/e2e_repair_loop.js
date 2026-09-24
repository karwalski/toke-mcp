#!/usr/bin/env node
/**
 * e2e_repair_loop.js — End-to-end test harness for the generate -> check -> fix -> repeat loop.
 *
 * Simulates the Claude Code toke-repair subagent workflow using a rule-based fixer
 * instead of an LLM. Imports toke_check and toke_compile directly (no running MCP
 * server required).
 *
 * NOTE: The rule-based fixer here is a simplified proxy for what the real repair loop
 * does via an LLM. It handles the most common error codes (E1003, E2001, E2003, E3011,
 * E4010/E4031) with pattern-based rewrites. The actual toke-repair subagent in
 * claude-plugin/agents/toke-repair.md uses Claude to interpret diagnostics and apply
 * contextual fixes, achieving higher repair rates.
 *
 * Fixtures are self-contained below (story 132.74). This harness used to read
 * task YAML from toke-eval/benchmark/hidden_tests/, which workspace AGENTS.md §5
 * makes move/preserve-only; it only ever used each task's id and description,
 * so those now live here with the draft source they index.
 *
 * Usage:
 *   node test/e2e_repair_loop.js [--max-iterations 5] [--tasks 20] [--verbose]
 *                                [--out report.json]
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tokeCheck } from "../tools/check.js";
import { tokeCompile } from "../tools/compile.js";

const DEFAULT_RESULTS_PATH = join(tmpdir(), "toke-mcp-e2e_results.json");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { maxIterations: 5, tasks: 20, verbose: false, out: DEFAULT_RESULTS_PATH };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      opts.out = args[i + 1];
      i++;
      continue;
    }
    if (args[i] === "--max-iterations" && args[i + 1]) {
      opts.maxIterations = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--tasks" && args[i + 1]) {
      opts.tasks = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--verbose") {
      opts.verbose = true;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Task fixtures — local to this file; nothing is read from toke-eval.
// ---------------------------------------------------------------------------

const DESCRIPTIONS = [
  "sum of a list", "product of a list", "minimum of a list", "maximum of a list",
  "integer mean of a list", "a mod b", "integer power", "gcd", "lcm",
  "primality test", "nth fibonacci", "factorial", "absolute value", "negation",
  "integer square root", "clamp to a range", "sum of squares",
  "count even elements", "count odd elements", "sum of positive elements",
];

function loadTasks(count) {
  return DESCRIPTIONS.slice(0, count).map((description, i) => ({
    id: `fixture-${String(i + 1).padStart(2, "0")}`,
    category: "fixture",
    description,
  }));
}

// ---------------------------------------------------------------------------
// Naive solution generator — produces intentionally imperfect Toke code
// from task descriptions, introducing common mistakes that the fixer must
// repair. This simulates a first-draft LLM generation.
// ---------------------------------------------------------------------------

const GENERATORS = {
  "fixture-01": () => `M=solution;
F=solve(nums:[i64]):i64{
  let sum=mut.0;
  lp(let i=mut.0;i<nums.len;i=i+1){
    sum=sum+nums[i]
  };
  <sum
};
F=main():i64{
  let r=solve([1;2;3]);
  <r
};`,

  "fixture-02": () => `M=solution;
F=solve(nums:[i64]):i64{
  let prod=mut.1;
  lp(let i=mut.0;i<nums.len;i=i+1){
    prod=prod*nums[i]
  };
  <prod
};
F=main():i64{
  let r=solve([2;3;4]);
  <r
};`,

  "fixture-03": () => `M=solution;
F=solve(nums:[i64]):i64{
  let m=mut.nums[0];
  lp(let i=mut.1;i<nums.len;i=i+1){
    if(nums[i]<m){
      m=nums[i]
    }
  };
  <m
};
F=main():i64{
  let r=solve([5;3;8;1]);
  <r
};`,

  "fixture-04": () => `M=solution;
F=solve(nums:[i64]):i64{
  let m=mut.nums[0];
  lp(let i=mut.1;i<nums.len;i=i+1){
    if(nums[i]>m){
      m=nums[i]
    }
  };
  <m
};
F=main():i64{
  let r=solve([5;3;8;1]);
  <r
};`,

  "fixture-05": () => `M=solution;
F=solve(nums:[i64]):i64{
  let sum=mut.0;
  lp(let i=mut.0;i<nums.len;i=i+1){
    sum=sum+nums[i]
  };
  <sum/nums.len
};
F=main():i64{
  let r=solve([1;2;3]);
  <r
};`,

  "fixture-06": () => `M=solution;
F=solve(a:i64;b:i64):i64{
  <a-a/b*b
};
F=main():i64{
  let r=solve(10;3);
  <r
};`,

  "fixture-07": () => `M=solution;
F=solve(base:i64;exp:i64):i64{
  let result=mut.1;
  lp(let i=mut.0;i<exp;i=i+1){
    result=result*base
  };
  <result
};
F=main():i64{
  let r=solve(2;10);
  <r
};`,

  "fixture-08": () => `M=solution;
F=solve(a:i64;b:i64):i64{
  let x=mut.a;
  let y=mut.b;
  lp(;y>0;){
    let t=y;
    y=x-x/y*y;
    x=t
  };
  <x
};
F=main():i64{
  let r=solve(12;8);
  <r
};`,

  "fixture-09": () => `M=solution;
F=gcd(a:i64;b:i64):i64{
  let x=mut.a;
  let y=mut.b;
  lp(;y>0;){
    let t=y;
    y=x-x/y*y;
    x=t
  };
  <x
};
F=solve(a:i64;b:i64):i64{
  if(a=0){<0};
  if(b=0){<0};
  <a/gcd(a;b)*b
};
F=main():i64{
  let r=solve(4;6);
  <r
};`,

  "fixture-10": () => `M=solution;
F=solve(n:i64):bool{
  if(n<2){<false};
  let i=mut.2;
  lp(;i*i<n+1;i=i+1){
    if(n-n/i*i=0){<false}
  };
  <true
};
F=main():i64{
  if(solve(7)){<1};
  <0
};`,

  "fixture-11": () => `M=solution;
F=solve(n:i64):i64{
  if(n<2){<n};
  let a=mut.0;
  let b=mut.1;
  lp(let i=mut.2;i<n+1;i=i+1){
    let t=b;
    b=a+b;
    a=t
  };
  <b
};
F=main():i64{
  let r=solve(10);
  <r
};`,

  "fixture-12": () => `M=solution;
F=solve(n:i64):i64{
  let r=mut.1;
  lp(let i=mut.1;i<n+1;i=i+1){
    r=r*i
  };
  <r
};
F=main():i64{
  let r=solve(5);
  <r
};`,

  "fixture-13": () => `M=solution;
F=solve(n:i64):i64{
  if(n<0){<0-n};
  <n
};
F=main():i64{
  let r=solve(0-5);
  <r
};`,

  "fixture-14": () => `M=solution;
F=solve(n:i64):i64{
  <0-n
};
F=main():i64{
  let r=solve(42);
  <r
};`,

  "fixture-15": () => `M=solution;
F=solve(n:i64):i64{
  if(n=0){<0};
  let r=mut.n;
  let x=mut.n;
  lp(;x>0;){
    x=n/r;
    if(x>r+1){
      r=(r+x)/2
    }el{
      br
    }
  };
  <r
};
F=main():i64{
  let r=solve(16);
  <r
};`,

  "fixture-16": () => `M=solution;
F=solve(v:i64;lo:i64;hi:i64):i64{
  if(v<lo){<lo};
  if(v>hi){<hi};
  <v
};
F=main():i64{
  let r=solve(5;1;10);
  <r
};`,

  "fixture-17": () => `M=solution;
F=solve(nums:[i64]):i64{
  let sum=mut.0;
  lp(let i=mut.0;i<nums.len;i=i+1){
    sum=sum+nums[i]*nums[i]
  };
  <sum
};
F=main():i64{
  let r=solve([2;3;4]);
  <r
};`,

  "fixture-18": () => `M=solution;
F=solve(nums:[i64]):i64{
  let count=mut.0;
  lp(let i=mut.0;i<nums.len;i=i+1){
    if(nums[i]-nums[i]/2*2=0){
      count=count+1
    }
  };
  <count
};
F=main():i64{
  let r=solve([1;2;3;4;5;6]);
  <r
};`,

  "fixture-19": () => `M=solution;
F=solve(nums:[i64]):i64{
  let count=mut.0;
  lp(let i=mut.0;i<nums.len;i=i+1){
    let rem=nums[i]-nums[i]/2*2;
    if(rem=1){
      count=count+1
    }el{
      if(rem=0-1){
        count=count+1
      }
    }
  };
  <count
};
F=main():i64{
  let r=solve([1;2;3;4;5;6]);
  <r
};`,

  "fixture-20": () => `M=solution;
F=solve(nums:[i64]):i64{
  let sum=mut.0;
  lp(let i=mut.0;i<nums.len;i=i+1){
    if(nums[i]>0){
      sum=sum+nums[i]
    }
  };
  <sum
};
F=main():i64{
  let r=solve([0-3;0;5;0-1;7]);
  <r
};`,
};

/**
 * Generate a naive (intentionally broken) Toke solution for a task.
 * Uses predefined templates that introduce common mistakes the fixer
 * must repair.
 */
function generateNaiveSolution(task) {
  const gen = GENERATORS[task.id];
  if (gen) return gen();

  // Fallback: generic template for unknown tasks
  return `M=solution;
F=solve(x:i64):i64{
  <x
};
F=main():i64{
  let r=solve(0);
  <r
};`;
}

// ---------------------------------------------------------------------------
// Rule-based fixer — simulates what the LLM would do for common errors.
//
// NOTE: This is a simplified proxy. The real repair loop uses an LLM (Claude)
// to interpret diagnostics contextually and apply semantic fixes. This fixer
// only handles mechanical pattern-based repairs for the most common error
// codes encountered in naive Toke generation.
// ---------------------------------------------------------------------------

function applyFixes(source, diagnostics) {
  let fixed = source;
  const applied = [];

  // Sort diagnostics by line descending so edits don't shift earlier line numbers
  const sorted = [...diagnostics].sort((a, b) => (b.line || 0) - (a.line || 0));

  for (const diag of sorted) {
    const code = diag.code || "";
    const line = diag.line || 0;
    const message = diag.message || "";
    const fix = diag.fix || "";

    // E1003 — invalid character
    if (code === "E1003") {
      // Replace underscores with camelCase
      if (message.includes("_")) {
        fixed = fixed.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
        applied.push({ code, fix: "replaced _ with camelCase" });
      }
      // Replace stray commas with semicolons
      if (message.includes(",") || fixed.includes(",")) {
        fixed = fixed.replace(/,/g, ";");
        applied.push({ code, fix: "replaced , with ;" });
      }
      continue;
    }

    // E2001 — syntax / declaration ordering
    if (code === "E2001") {
      // If the fix field suggests something, use it
      if (fix) {
        applied.push({ code, fix: `compiler suggests: ${fix}` });
      }
      // Try to add missing semicolons after closing braces
      fixed = fixed.replace(/\}(\s*)(F=|$)/g, "};$1$2");
      applied.push({ code, fix: "ensured }; after blocks" });
      continue;
    }

    // E2002 — unexpected token
    if (code === "E2002") {
      if (fix) {
        applied.push({ code, fix: `compiler suggests: ${fix}` });
      }
      continue;
    }

    // E2003 — missing semicolon
    if (code === "E2003") {
      const lines = fixed.split("\n");
      if (line > 0 && line <= lines.length) {
        const idx = line - 1;
        const ln = lines[idx];
        // Add semicolon at end of line if missing
        if (!ln.trimEnd().endsWith(";") && !ln.trimEnd().endsWith("{") && !ln.trimEnd().endsWith("}")) {
          lines[idx] = ln.trimEnd() + ";";
          fixed = lines.join("\n");
          applied.push({ code, fix: `added ; at end of line ${line}` });
        }
      }
      continue;
    }

    // E3011 — undefined identifier
    if (code === "E3011") {
      // Extract identifier name from message
      const match = message.match(/(?:undeclared|undefined|unknown)\s+(?:identifier\s+)?['"]?(\w+)['"]?/i)
        || message.match(/'(\w+)'/);
      if (match) {
        const ident = match[1];
        // Add a let declaration before the first use
        const lines = fixed.split("\n");
        if (line > 0 && line <= lines.length) {
          const insertIdx = line - 1;
          const indent = lines[insertIdx].match(/^(\s*)/)[1];
          lines.splice(insertIdx, 0, `${indent}let ${ident}=mut.0;`);
          fixed = lines.join("\n");
          applied.push({ code, fix: `added let ${ident}=mut.0 before line ${line}` });
        }
      }
      continue;
    }

    // E4010 / E4031 — type mismatch
    if (code === "E4010" || code === "E4031") {
      // Try to extract target type from message and add a cast
      const castMatch = message.match(/expected\s+(\w+)/i);
      if (castMatch && line > 0) {
        const targetType = castMatch[1];
        const lines = fixed.split("\n");
        if (line <= lines.length) {
          // Try to wrap the expression on that line with `as targetType`
          const ln = lines[line - 1];
          // Look for return expressions: <expr -> <(expr) as type
          const retMatch = ln.match(/^(\s*)<(.+?)(;?)$/);
          if (retMatch) {
            lines[line - 1] = `${retMatch[1]}<(${retMatch[2].trim()}) as ${targetType}${retMatch[3]}`;
            fixed = lines.join("\n");
            applied.push({ code, fix: `added as ${targetType} cast at line ${line}` });
          }
        }
      }
      continue;
    }
  }

  return { fixed, applied };
}

// ---------------------------------------------------------------------------
// Extract diagnostics array from toke_check result
// ---------------------------------------------------------------------------

// tkc emits one JSON object per line, with `error_code` and `pos.line`; the
// fixer below reads `code` and `line`. Normalise to that shape.
function normaliseDiag(d) {
  return {
    ...d,
    code: d.code || d.error_code || "",
    line: d.line || (d.pos && d.pos.line) || 0,
    col: d.col || (d.pos && d.pos.col) || 0,
  };
}

function extractDiagnostics(result) {
  // tokeCheck returns: a parsed object when tkc printed exactly one JSON
  // document, { raw, ok } when it printed JSON Lines or text, { error } when
  // tkc could not run. Before 132.74 every shape except an array or
  // { diagnostics } fell through to [], so a rejected program scored PASS.
  if (Array.isArray(result)) return result.map(normaliseDiag);
  if (Array.isArray(result.diagnostics)) return result.diagnostics.map(normaliseDiag);
  if (result.error_code || result.code) return [normaliseDiag(result)];
  if (result.error) return [{ code: "TOOL", message: result.error }];
  if (typeof result.raw === "string") {
    const diags = [];
    for (const line of result.raw.split("\n")) {
      try {
        const obj = JSON.parse(line);
        if (obj && (obj.error_code || obj.code)) diags.push(normaliseDiag(obj));
      } catch {
        // not a diagnostic line
      }
    }
    if (diags.length > 0) return diags;
  }
  if (result.ok === true) return [];
  return [{ code: "TOOL", message: `unrecognised tkc output: ${JSON.stringify(result).slice(0, 200)}` }];
}

function hasPassed(diagnostics) {
  return diagnostics.length === 0
    || diagnostics.every((d) => !d.code || d.code.startsWith("W"));
}

// ---------------------------------------------------------------------------
// Repair loop — generate -> check -> fix -> repeat
// ---------------------------------------------------------------------------

async function runRepairLoop(task, maxIterations, verbose) {
  const taskResult = {
    task_id: task.id,
    category: task.category || "unknown",
    description: task.description || "",
    iterations: 0,
    final_status: "fail",
    error_codes_seen: [],
    fixes_applied: [],
    compiled: false,
  };

  let source = generateNaiveSolution(task);
  const allErrorCodes = new Set();

  for (let iter = 1; iter <= maxIterations; iter++) {
    taskResult.iterations = iter;

    if (verbose) {
      console.log(`  [${task.id}] iteration ${iter}`);
    }

    // Call toke_check directly (no MCP server needed)
    let checkResult;
    try {
      checkResult = await tokeCheck(source);
    } catch (err) {
      if (verbose) console.log(`  [${task.id}] toke_check threw: ${err.message}`);
      taskResult.error_codes_seen = [...allErrorCodes];
      return taskResult;
    }

    const diagnostics = extractDiagnostics(checkResult);

    // Collect error codes
    for (const d of diagnostics) {
      if (d.code) allErrorCodes.add(d.code);
    }

    if (verbose && diagnostics.length > 0) {
      for (const d of diagnostics) {
        console.log(`    ${d.code || "?"} L${d.line || "?"}:${d.col || "?"} ${d.message || ""}`);
      }
    }

    // Check if we passed
    if (hasPassed(diagnostics)) {
      taskResult.final_status = "pass";
      break;
    }

    // Apply rule-based fixes
    const { fixed, applied } = applyFixes(source, diagnostics);
    taskResult.fixes_applied.push(...applied);

    if (verbose && applied.length > 0) {
      for (const a of applied) {
        console.log(`    FIX ${a.code}: ${a.fix}`);
      }
    }

    // If no fixes were applied and source did not change, stop early
    if (fixed === source) {
      if (verbose) console.log(`  [${task.id}] no fixes applicable, stopping`);
      break;
    }

    source = fixed;
  }

  taskResult.error_codes_seen = [...allErrorCodes];

  // Optionally compile passing solutions
  if (taskResult.final_status === "pass") {
    try {
      const compileResult = await tokeCompile(source);
      taskResult.compiled = compileResult.ok === true;
      if (verbose) {
        console.log(`  [${task.id}] compile: ${taskResult.compiled ? "OK" : "FAIL"}`);
      }
    } catch {
      taskResult.compiled = false;
    }
  }

  return taskResult;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  console.log(`e2e_repair_loop: ${opts.tasks} tasks, max ${opts.maxIterations} iterations`);
  console.log(`NOTE: rule-based fixer is a simplified proxy; real repair loop uses an LLM\n`);

  const tasks = loadTasks(opts.tasks);

  console.log(`Loaded ${tasks.length} tasks\n`);

  const results = [];
  for (const task of tasks) {
    if (opts.verbose) console.log(`--- ${task.id}: ${task.description} ---`);
    const result = await runRepairLoop(task, opts.maxIterations, opts.verbose);
    results.push(result);
    const status = result.final_status === "pass" ? "PASS" : "FAIL";
    console.log(`${status}  ${task.id}  iters=${result.iterations}  errors=[${result.error_codes_seen.join(";")}]`);
  }

  // Summary
  const passed = results.filter((r) => r.final_status === "pass").length;
  const total = results.length;
  const avgIters =
    results.reduce((s, r) => s + r.iterations, 0) / total;

  // Most common error codes
  const errorFreq = {};
  for (const r of results) {
    for (const code of r.error_codes_seen) {
      errorFreq[code] = (errorFreq[code] || 0) + 1;
    }
  }
  const topErrors = Object.entries(errorFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => `${code}(${count})`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${total} passed`);
  console.log(`Average iterations: ${avgIters.toFixed(1)}`);
  console.log(`Top errors: ${topErrors.join(", ") || "none"}`);
  console.log(`Compiled: ${results.filter((r) => r.compiled).length}/${passed} passing`);
  console.log(`========================================\n`);

  // Write JSON report
  const report = {
    timestamp: new Date().toISOString(),
    config: { maxIterations: opts.maxIterations, taskCount: total },
    summary: {
      passed,
      total,
      passRate: `${((passed / total) * 100).toFixed(1)}%`,
      averageIterations: parseFloat(avgIters.toFixed(1)),
      topErrors: errorFreq,
      compiled: results.filter((r) => r.compiled).length,
    },
    results,
  };

  await writeFile(opts.out, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Report written to ${opts.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
