"use strict";

const { execFile } = require("node:child_process");
const { writeFile, unlink } = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

const TKC_PATH = process.env.TKC_PATH || "/opt/bin/tkc";
const TIMEOUT_MS = 9_000; // 9s hard kill (Lambda has 10s total)
const MAX_SOURCE_BYTES = 64 * 1024; // 64 KB

/**
 * toke_check Lambda handler.
 *
 * Input:  { source: string }
 * Output: { ok: bool, diagnostics: object[] } | { error: string }
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

    const tmpFile = path.join("/tmp", `toke-${randomUUID()}.tk`);
    await writeFile(tmpFile, source, "utf8");

    try {
      const { stdout, stderr, exitCode } = await run(
        TKC_PATH,
        ["--check", "--diag-json", tmpFile],
        TIMEOUT_MS,
      );

      // tkc --diag-json writes JSON diagnostics to stdout
      let diagnostics = [];
      if (stdout.trim().length > 0) {
        try {
          diagnostics = JSON.parse(stdout);
        } catch {
          // If JSON parse fails, return raw output
          return response(200, {
            ok: false,
            diagnostics: [],
            raw: stdout,
            stderr: stderr || undefined,
          });
        }
      }

      const ok = exitCode === 0 && diagnostics.every((d) => d.severity !== "error");
      return response(200, { ok, diagnostics });
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  } catch (err) {
    if (err.killed || err.signal === "SIGTERM") {
      return response(504, { error: "Compilation timed out" });
    }
    console.error("check handler error:", err);
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
