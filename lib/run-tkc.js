/**
 * run-tkc.js — the one way the tools run the tkc compiler (toke 121.26,
 * audit 120.15 TOK-02).
 *
 * Every compiler-backed tool writes untrusted source to a temp file and runs
 * the native tkc on it. Each call used to be a bare execFile with a
 * wall-clock timeout and nothing else: no cap on how many tkc processes run
 * at once, no cap on captured output, no memory cap. execTkc keeps
 * execFile's promise contract ({ stdout, stderr }, and on failure an Error
 * carrying code/stdout/stderr) and adds:
 *
 *   TKC_MAX_CONCURRENT  (default: CPU count)  tkc processes running at once;
 *                                             further calls wait in a queue.
 *   TKC_MAX_QUEUE       (default: 32)         calls waiting; past this a
 *                                             call fails at once with
 *                                             code "EBUSY" -- refused, not
 *                                             queued without bound.
 *   TKC_MEMORY_LIMIT_MB (default: unset)      if set, tkc runs under
 *                                             `ulimit -v`. Linux only: where
 *                                             the shell cannot apply it
 *                                             (macOS), the call fails with
 *                                             exit 125 rather than run
 *                                             unlimited.
 *   maxBuffer 4 MiB per stream, unless the caller passes its own.
 *
 * Arguments are always passed as an argv array (no shell interpolation):
 * with a memory limit, /bin/sh receives them as positional parameters and
 * `exec "$@"`s them untouched.
 *
 * The OS-level boundary -- a dedicated low-privilege user, a container, a
 * cgroup -- is the operator's; SELF_HOSTED.md says so.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cpus } from "node:os";

const execFileAsync = promisify(execFile);

function positiveInt(name, dflt) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

let running = 0;
const waiting = [];

function limits() {
  return {
    maxConcurrent: positiveInt("TKC_MAX_CONCURRENT", Math.max(1, cpus().length)),
    maxQueue: positiveInt("TKC_MAX_QUEUE", 32),
    memoryMb: positiveInt("TKC_MEMORY_LIMIT_MB", 0),
  };
}

function acquire() {
  const { maxConcurrent, maxQueue } = limits();
  if (running < maxConcurrent) { running++; return Promise.resolve(); }
  if (waiting.length >= maxQueue) {
    const err = new Error(`tkc is busy: ${running} running and ${waiting.length} waiting; try again shortly`);
    err.code = "EBUSY";
    return Promise.reject(err);
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();          /* hand the slot straight to the next caller */
  else running--;
}

/**
 * Run tkc. Same contract as promisify(execFile)(file, args, options).
 *
 * @param {string} file     - the tkc binary
 * @param {string[]} args
 * @param {object} [options] - execFile options (timeout, maxBuffer, env, ...)
 */
export async function execTkc(file, args, options = {}) {
  await acquire();
  try {
    const opts = { maxBuffer: DEFAULT_MAX_BUFFER, ...options };
    const { memoryMb } = limits();
    if (memoryMb > 0) {
      const kb = String(memoryMb * 1024);
      return await execFileAsync(
        "/bin/sh",
        ["-c", 'ulimit -v "$1" || exit 125; shift; exec "$@"', "sh", kb, file, ...args],
        opts,
      );
    }
    return await execFileAsync(file, args, opts);
  } finally {
    release();
  }
}

/** For tests: how many tkc processes are running and waiting. */
export function tkcLoad() {
  return { running, waiting: waiting.length };
}
