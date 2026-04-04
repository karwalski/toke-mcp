"use strict";

const { execFile } = require("node:child_process");
const { writeFile, readFile, unlink } = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

const TKC_PATH = process.env.TKC_PATH || "/opt/bin/tkc";
const TIMEOUT_MS = 9_000; // 9s hard kill (Lambda has 10s total)
const MAX_SOURCE_BYTES = 64 * 1024; // 64 KB

/**
 * toke_compile Lambda handler.
 *
 * Input:  { source: string }
 * Output: { ok: bool, ir: string } | { ok: false, diagnostics: object[] } | { error: string }
 */
exports.handler = async (event) => {
  try {
    const source = event.source ?? event.body?.source;
    if (typeof source !== "string" || source.length === 0) {
      return response(400, { error: "Missing or empty 'source' field" });
    }
    if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
      return response(413, { error: `Source exceeds ${MAX_SOURCE_BYTES} byte limit` });
    }

    const id = randomUUID();
    const tmpFile = path.join("/tmp", `toke-${id}.tk`);
    const outFile = path.join("/tmp", `toke-${id}.ll`);
    await writeFile(tmpFile, source, "utf8");

    try {
      // First try to compile to LLVM IR
      const { stdout, stderr, exitCode } = await run(
        TKC_PATH,
        ["--emit-llvm", "-o", outFile, tmpFile],
        TIMEOUT_MS,
      );

      if (exitCode === 0) {
        // Success -- read the IR output
        const ir = await readFile(outFile, "utf8");
        return response(200, { ok: true, ir });
      }

      // Compilation failed -- try to get structured diagnostics
      const diagResult = await run(
        TKC_PATH,
        ["--check", "--diag-json", tmpFile],
        TIMEOUT_MS,
      );

      let diagnostics = [];
      if (diagResult.stdout.trim().length > 0) {
        try {
          diagnostics = JSON.parse(diagResult.stdout);
        } catch {
          // Fall through with empty diagnostics
        }
      }

      return response(200, {
        ok: false,
        diagnostics,
        stderr: stderr || undefined,
      });
    } finally {
      await Promise.all([
        unlink(tmpFile).catch(() => {}),
        unlink(outFile).catch(() => {}),
      ]);
    }
  } catch (err) {
    if (err.killed || err.signal === "SIGTERM") {
      return response(504, { error: "Compilation timed out" });
    }
    console.error("compile handler error:", err);
    return response(500, { error: "Internal error", detail: err.message });
  }
};

/**
 * Run a child process with a timeout. Returns { stdout, stderr, exitCode }.
 */
function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024, // 2 MB
        env: { ...process.env, HOME: "/tmp" },
      },
      (err, stdout, stderr) => {
        if (err && err.killed) {
          return reject(err);
        }
        resolve({
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: err ? err.code ?? 1 : 0,
        });
      },
    );
  });
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
