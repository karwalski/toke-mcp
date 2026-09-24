#!/usr/bin/env node
/**
 * e2e_repair_loop.js — End-to-end test of the generate -> check -> fix -> repeat loop.
 *
 * Simulates the Claude Code toke-repair subagent workflow using a rule-based fixer
 * instead of an LLM. Imports toke_check and toke_compile directly (no running MCP
 * server required), so it needs a real tkc (TKC_PATH, else `tkc` on PATH) and
 * nothing else: no network.
 *
 * Fixtures are self-contained below (story 132.74). This harness used to read
 * task YAML from toke-eval/benchmark/hidden_tests/, which workspace AGENTS.md §5
 * makes move/preserve-only.
 *
 * 132.84: the fixtures are v0.4 (toke-spec-v0.4.md). Each draft is a correct
 * v0.4 program with the mistakes a model trained on the legacy syntax makes:
 * uppercase `M=`/`F=` (E1006), square brackets for arrays and indexing
 * (E1003), and `=` for equality (E2002). The fixer's scope is exactly those
 * three, applied at the offsets tkc reports; anything else is out of scope
 * and ends the loop for that task.
 *
 * It asserts, and exits 1 on any failure:
 *   - every draft is rejected on the first check, with exactly the codes its
 *     fixture declares (a draft that already compiles would pass vacuously);
 *   - at least --floor tasks (default: every task run) end with a clean check;
 *   - every task that passes also compiles (--emit-llvm).
 * With --run it also builds each repaired program and checks main's exit code
 * against the fixture's `returns` (slow: about 2s a program).
 *
 * Usage:
 *   node test/e2e_repair_loop.js [--max-iterations 5] [--tasks 20] [--floor N]
 *                                [--run] [--verbose] [--out report.json]
 */

import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TKC_PATH = process.env.TKC_PATH || "tkc";
const DEFAULT_RESULTS_PATH = join(tmpdir(), "toke-mcp-e2e_results.json");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { maxIterations: 5, tasks: FIXTURES.length, floor: null, run: false, verbose: false, out: DEFAULT_RESULTS_PATH };
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === "--out" && next) { opts.out = next; i++; }
    else if (args[i] === "--max-iterations" && next) { opts.maxIterations = parseInt(next, 10); i++; }
    else if (args[i] === "--tasks" && next) { opts.tasks = parseInt(next, 10); i++; }
    else if (args[i] === "--floor" && next) { opts.floor = parseInt(next, 10); i++; }
    else if (args[i] === "--run") opts.run = true;
    else if (args[i] === "--verbose") opts.verbose = true;
    else { console.error(`unknown argument: ${args[i]}`); process.exit(2); }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Task fixtures — local to this file; nothing is read from toke-eval.
//
// `first` is what tkc 3.0.0 reports on the draft's first check (lexer errors
// stop the parse, so an E2002 in a draft that also has E1006 shows up on a
// later iteration). `returns` is main's exit code once repaired, verified by
// building and running each repaired program (--run) on 2026-09-24.
// ---------------------------------------------------------------------------

const FIXTURES = [
  {
    id: "fixture-01",
    returns: 6,
    description: "sum of a list",
    first: ["E1003", "E1006"],
    draft: `M=solution;
F=solve(nums:[i64]):i64{
  let sum=mut.0;
  lp(let i=0;i<nums.len;i=i+1){
    sum=sum+nums[i]
  };
  <sum
};
F=main():i64{
  let r=solve([1;2;3]);
  <r
};`,
  },
  {
    id: "fixture-02",
    returns: 24,
    description: "product of a list",
    first: ["E1003", "E1006"],
    draft: `M=solution;
F=solve(nums:[i64]):i64{
  let prod=mut.1;
  lp(let i=0;i<nums.len;i=i+1){
    prod=prod*nums[i]
  };
  <prod
};
F=main():i64{
  let r=solve([2;3;4]);
  <r
};`,
  },
  {
    id: "fixture-03",
    returns: 1,
    description: "minimum of a list",
    first: ["E1003", "E1006"],
    draft: `M=solution;
F=solve(nums:[i64]):i64{
  let m=mut.nums[0];
  lp(let i=1;i<nums.len;i=i+1){
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
  },
  {
    id: "fixture-04",
    returns: 8,
    description: "maximum of a list",
    first: ["E1003", "E1006"],
    draft: `M=solution;
F=solve(nums:[i64]):i64{
  let m=mut.nums[0];
  lp(let i=1;i<nums.len;i=i+1){
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
  },
  {
    id: "fixture-05",
    returns: 2,
    description: "integer mean of a list",
    first: ["E1003", "E1006"],
    draft: `M=solution;
F=solve(nums:[i64]):i64{
  let sum=mut.0;
  lp(let i=0;i<nums.len;i=i+1){
    sum=sum+nums[i]
  };
  <sum/nums.len
};
F=main():i64{
  let r=solve([1;2;3]);
  <r
};`,
  },
  {
    id: "fixture-06",
    returns: 1,
    description: "a mod b",
    first: ["E1006"],
    draft: `M=solution;
F=solve(a:i64;b:i64):i64{
  if(b=0){<0};
  <a-a/b*b
};
F=main():i64{
  let r=solve(10;3);
  <r
};`,
  },
  {
    id: "fixture-07",
    returns: 128,
    description: "integer power",
    first: ["E1006"],
    draft: `M=solution;
F=solve(base:i64;exp:i64):i64{
  let result=mut.1;
  lp(let i=0;i<exp;i=i+1){
    result=result*base
  };
  <result
};
F=main():i64{
  let r=solve(2;7);
  <r
};`,
  },
  {
    id: "fixture-08",
    returns: 4,
    description: "gcd",
    first: ["E1006"],
    draft: `M=solution;
F=solve(a:i64;b:i64):i64{
  let x=mut.a;
  let y=mut.b;
  lp(let k=0;y>0;k=k+1){
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
  },
  {
    id: "fixture-09",
    returns: 12,
    description: "lcm",
    first: ["E1006"],
    draft: `M=solution;
F=gcd(a:i64;b:i64):i64{
  let x=mut.a;
  let y=mut.b;
  lp(let k=0;y>0;k=k+1){
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
  },
  {
    id: "fixture-10",
    returns: 1,
    description: "primality test",
    first: ["E1006"],
    draft: `M=solution;
F=solve(n:i64):bool{
  if(n<2){<false};
  lp(let i=2;i*i<n+1;i=i+1){
    if(n-n/i*i=0){<false}
  };
  <true
};
F=main():i64{
  if(solve(7)){<1};
  <0
};`,
  },
  {
    id: "fixture-11",
    returns: 55,
    description: "nth fibonacci",
    first: ["E1006"],
    draft: `M=solution;
F=solve(n:i64):i64{
  if(n<2){<n};
  let a=mut.0;
  let b=mut.1;
  lp(let i=2;i<n+1;i=i+1){
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
  },
  {
    id: "fixture-12",
    returns: 120,
    description: "factorial",
    first: ["E1006"],
    draft: `M=solution;
F=solve(n:i64):i64{
  let r=mut.1;
  lp(let i=1;i<n+1;i=i+1){
    r=r*i
  };
  <r
};
F=main():i64{
  let r=solve(5);
  <r
};`,
  },
  {
    id: "fixture-13",
    returns: 5,
    description: "absolute value",
    first: ["E1006"],
    draft: `M=solution;
F=solve(n:i64):i64{
  if(n<0){<0-n};
  <n
};
F=main():i64{
  let r=solve(0-5);
  <r
};`,
  },
  {
    id: "fixture-14",
    returns: 42,
    description: "negation",
    first: ["E1006"],
    draft: `M=solution;
F=solve(n:i64):i64{
  <0-n
};
F=main():i64{
  let r=solve(0-42);
  <r
};`,
  },
  {
    id: "fixture-15",
    returns: 4,
    description: "integer square root",
    first: ["E2002"],
    draft: `m=solution;
f=solve(n:i64):i64{
  if(n=0){<0};
  let r=mut.n;
  lp(let k=0;r*r>n;k=k+1){
    r=(r+n/r)/2
  };
  <r
};
f=main():i64{
  let r=solve(16);
  <r
};`,
  },
  {
    id: "fixture-16",
    returns: 10,
    description: "clamp to a range",
    first: ["E1006"],
    draft: `M=solution;
F=solve(v:i64;lo:i64;hi:i64):i64{
  if(v<lo){<lo};
  if(v>hi){<hi};
  <v
};
F=main():i64{
  let r=solve(15;1;10);
  <r
};`,
  },
  {
    id: "fixture-17",
    returns: 29,
    description: "sum of squares",
    first: ["E1003", "E1006"],
    draft: `M=solution;
F=solve(nums:[i64]):i64{
  let sum=mut.0;
  lp(let i=0;i<nums.len;i=i+1){
    sum=sum+nums[i]*nums[i]
  };
  <sum
};
F=main():i64{
  let r=solve([2;3;4]);
  <r
};`,
  },
  {
    id: "fixture-18",
    returns: 3,
    description: "count even elements",
    first: ["E1003", "E1006"],
    draft: `M=solution;
F=solve(nums:[i64]):i64{
  let count=mut.0;
  lp(let i=0;i<nums.len;i=i+1){
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
  },
  {
    id: "fixture-19",
    returns: 4,
    description: "count odd elements",
    first: ["E1003"],
    draft: `m=solution;
f=solve(nums:[i64]):i64{
  let count=mut.0;
  lp(let i=0;i<nums.len;i=i+1){
    let rem=nums[i]-nums[i]/2*2;
    if(rem!=0){
      count=count+1
    }
  };
  <count
};
f=main():i64{
  let r=solve([1;2;3;4;5;0-7]);
  <r
};`,
  },
  {
    id: "fixture-20",
    returns: 12,
    description: "sum of positive elements",
    first: ["E1003", "E1006"],
    draft: `M=solution;
F=solve(nums:[i64]):i64{
  let sum=mut.0;
  lp(let i=0;i<nums.len;i=i+1){
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
  },
];

// ---------------------------------------------------------------------------
// Rule-based fixer — simulates what the LLM would do for common errors.
//
// Scope (132.84): exactly the three legacy-syntax mistakes the fixtures carry.
// Every edit is made at the offset tkc reports, after checking the source
// there is what the rule expects, so a rule can never edit the wrong place.
//   E1006  uppercase keyword `M=`/`F=`...  -> replace `got` with `expected`
//   E1003  `[` ... `]`                     -> `x[i]` becomes `x.get(i)`;
//                                             any other `[a;b]` becomes `@(a;b)`
//   E2002  "`=` is assignment; use `==`"   -> `=` becomes `==`
// (tkc's own E1003 `fix` says "replace '[' with '@('", which is wrong for an
// index: `nums[i]` must become `nums.get(i)`, not `nums@(i)`.)
// ---------------------------------------------------------------------------

export const FIXER_SCOPE = ["E1006", "E1003", "E2002"];

/** Offset of the `]` matching the `[` at `open`, or -1. */
function matchingBracket(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

function editsFor(src, d) {
  const at = d.pos?.offset;
  if (!Number.isInteger(at)) return null;
  switch (d.error_code) {
    case "E1006":
      if (!d.got || !d.expected || src.slice(at, at + d.got.length) !== d.got) return null;
      return [{ at, len: d.got.length, text: d.expected }];
    case "E1003": {
      if (src[at] === "]") return []; // rewritten with its `[`
      if (src[at] !== "[") return null;
      const close = matchingBracket(src, at);
      if (close < 0) return null;
      const isIndex = /[A-Za-z0-9_)]/.test(src[at - 1] || "");
      return [
        { at, len: 1, text: isIndex ? ".get(" : "@(" },
        { at: close, len: 1, text: ")" },
      ];
    }
    case "E2002":
      if (!/use `==` for equality/.test(d.message || "") || src[at] !== "=") return null;
      return [{ at, len: 1, text: "==" }];
    default:
      return null;
  }
}

function applyFixes(source, diagnostics) {
  const edits = [];
  const applied = [];
  const unhandled = [];
  for (const d of diagnostics) {
    const e = editsFor(source, d);
    if (e === null) { unhandled.push(d.error_code); continue; }
    if (e.length) applied.push({ code: d.error_code, at: d.pos.offset });
    edits.push(...e);
  }
  // Apply from the end so earlier offsets stay valid; drop duplicates.
  edits.sort((a, b) => b.at - a.at);
  let fixed = source;
  let last = Infinity;
  for (const e of edits) {
    if (e.at >= last) continue;
    fixed = fixed.slice(0, e.at) + e.text + fixed.slice(e.at + e.len);
    last = e.at;
  }
  return { fixed, applied, unhandled };
}

// ---------------------------------------------------------------------------
// Repair loop — generate -> check -> fix -> repeat
// ---------------------------------------------------------------------------

const errorCodes = (r) => r.diagnostics.filter((d) => d.severity !== "warning").map((d) => d.error_code);

async function runRepairLoop(task, maxIterations, verbose) {
  const result = {
    task_id: task.id,
    description: task.description,
    iterations: 0,
    final_status: "fail",
    first_codes: [],
    error_codes_seen: [],
    fixes_applied: 0,
    unhandled: [],
    compiled: false,
    source: task.draft,
  };

  let source = task.draft;
  const seen = new Set();

  for (let iter = 1; iter <= maxIterations; iter++) {
    result.iterations = iter;
    const check = await tokeCheck(source);
    if (check.error) {
      result.unhandled.push(`TOOL: ${check.error}`);
      break;
    }
    const codes = errorCodes(check);
    if (iter === 1) result.first_codes = [...new Set(codes)].sort();
    codes.forEach((c) => seen.add(c));

    if (verbose) {
      console.log(`  [${task.id}] iteration ${iter}: ${check.ok ? "clean" : codes.join(" ")}`);
    }
    if (check.ok) {
      result.final_status = "pass";
      break;
    }

    const { fixed, applied, unhandled } = applyFixes(source, check.diagnostics);
    result.fixes_applied += applied.length;
    result.unhandled.push(...unhandled);
    if (unhandled.length || fixed === source) break; // out of the fixer's scope
    source = fixed;
  }

  result.error_codes_seen = [...seen].sort();
  result.source = source;
  if (result.final_status === "pass") {
    const compiled = await tokeCompile(source);
    result.compiled = compiled.ok === true;
  }
  return result;
}

/** Build the repaired program and return main's exit code. */
async function runProgram(source, dir, id) {
  const src = join(dir, `${id}.tk`);
  const bin = join(dir, id);
  await writeFile(src, source + "\n", "utf-8");
  await execFileAsync(TKC_PATH, ["--out", bin, src], { timeout: 60_000 });
  try {
    await execFileAsync(bin, [], { timeout: 10_000 });
    return 0;
  } catch (err) {
    return typeof err.code === "number" ? err.code : null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let tokeCheck, tokeCompile;

async function main() {
  const opts = parseArgs();
  try {
    execFileSync(TKC_PATH, ["--version"], { stdio: "ignore" });
  } catch {
    console.error(`e2e_repair_loop: cannot run tkc at '${TKC_PATH}'. Set TKC_PATH; this test needs a real compiler.`);
    process.exit(1);
  }
  ({ tokeCheck } = await import("../tools/check.js"));
  ({ tokeCompile } = await import("../tools/compile.js"));

  const tasks = FIXTURES.slice(0, opts.tasks);
  const floor = opts.floor ?? tasks.length;
  console.log(`e2e_repair_loop: ${tasks.length} v0.4 fixtures, max ${opts.maxIterations} iterations, floor ${floor}`);
  console.log(`fixer scope: ${FIXER_SCOPE.join(", ")} (rule-based proxy; the real repair loop uses an LLM)\n`);

  const failures = [];
  const results = [];
  const runDir = opts.run ? await mkdtemp(join(tmpdir(), "toke-e2e-run-")) : null;
  for (const task of tasks) {
    const r = await runRepairLoop(task, opts.maxIterations, opts.verbose);
    results.push(r);
    const want = [...task.first].sort().join(";");
    if (r.first_codes.join(";") !== want) {
      failures.push(`${task.id}: first check gave [${r.first_codes.join(";")}], fixture declares [${want}]`);
    }
    if (r.final_status === "pass" && !r.compiled) failures.push(`${task.id}: checks clean but does not compile`);
    if (runDir && r.final_status === "pass") {
      r.returned = await runProgram(r.source, runDir, task.id);
      if (r.returned !== task.returns) failures.push(`${task.id}: returned ${r.returned}, expected ${task.returns}`);
    }
    const status = r.final_status === "pass" ? "PASS" : "FAIL";
    const extra = r.unhandled.length ? `  unhandled=[${[...new Set(r.unhandled)].join(";")}]` : "";
    console.log(`${status}  ${task.id}  iters=${r.iterations}  fixes=${r.fixes_applied}  errors=[${r.error_codes_seen.join(";")}]${extra}`);
  }
  if (runDir) await rm(runDir, { recursive: true, force: true });

  const passed = results.filter((r) => r.final_status === "pass").length;
  const compiled = results.filter((r) => r.compiled).length;
  const total = results.length;
  if (passed < floor) failures.push(`${passed}/${total} repaired, below the floor of ${floor}`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${total} repaired (floor ${floor})`);
  console.log(`Average iterations: ${(results.reduce((s, r) => s + r.iterations, 0) / total).toFixed(1)}`);
  console.log(`Compiled: ${compiled}/${passed} repaired`);
  if (opts.run) console.log(`Ran: ${results.filter((r, i) => r.returned === tasks[i].returns).length}/${passed} returned the expected value`);
  console.log(`========================================`);

  const report = {
    timestamp: new Date().toISOString(),
    config: { maxIterations: opts.maxIterations, taskCount: total, floor, run: opts.run },
    summary: { passed, total, compiled, failures },
    results,
  };
  await writeFile(opts.out, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Report written to ${opts.out}`);

  if (failures.length) {
    console.error(`\nFAILED:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
