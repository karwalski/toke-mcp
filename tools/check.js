import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { record } from "../lib/telemetry.js";
import { parseTkcDiagnostics, hasErrorDiagnostic } from "../lib/tkc-diagnostics.js";

const execFileAsync = promisify(execFile);

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * toke_check tool — accepts Toke source code, runs tkc --check --diag-json,
 * returns { ok, diagnostics, exitCode } with every diagnostic tkc emitted
 * (132.81). `raw` is added only when tkc printed non-JSON text; `error` only
 * when tkc could not be run at all.
 */
export async function tokeCheck(sourceCode) {
  const tmpFile = join(tmpdir(), `toke-check-${randomUUID()}.tk`);

  try {
    await writeFile(tmpFile, sourceCode, "utf-8");

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      ({ stdout, stderr } = await execFileAsync(
        TKC_PATH,
        ["--check", "--diag-json", tmpFile],
        { timeout: 10_000 }
      ));
    } catch (err) {
      // A non-numeric code (ENOENT, a timeout's signal) means tkc never ran
      // to completion: there are no diagnostics to report, only the failure.
      if (typeof err.code !== "number") {
        return { ok: false, diagnostics: [], error: err.message };
      }
      stdout = err.stdout || "";
      stderr = err.stderr || "";
      exitCode = err.code;
    }

    // tkc 3.0.0 writes JSON Lines diagnostics to stderr; read both streams.
    const { diagnostics, raw } = parseTkcDiagnostics(stderr, stdout);
    const ok = exitCode === 0 && !hasErrorDiagnostic(diagnostics);
    if (ok) record(sourceCode, "toke_check", 0);

    const result = { ok, diagnostics, exitCode };
    if (raw) result.raw = raw;
    return result;
  } catch (err) {
    return { ok: false, diagnostics: [], error: err.message };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
