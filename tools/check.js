import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { record } from "../lib/telemetry.js";

const execFileAsync = promisify(execFile);

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * toke_check tool — accepts Toke source code, runs tkc --check --diag-json,
 * returns JSON diagnostics.
 */
export async function tokeCheck(sourceCode) {
  const tmpFile = join(tmpdir(), `toke-check-${randomUUID()}.tk`);

  try {
    await writeFile(tmpFile, sourceCode, "utf-8");

    const { stdout, stderr } = await execFileAsync(
      TKC_PATH,
      ["--check", "--diag-json", tmpFile],
      { timeout: 10_000 }
    );

    // tkc --diag-json writes JSON diagnostics to stdout
    const output = stdout || stderr;

    try {
      const parsed = JSON.parse(output);
      // Record successful checks (no diagnostics = clean code)
      const errCount = Array.isArray(parsed.diagnostics) ? parsed.diagnostics.length : 0;
      if (errCount === 0) record(sourceCode, "toke_check", 0);
      return parsed;
    } catch {
      // If output is not valid JSON, wrap it — ok: true means clean check
      record(sourceCode, "toke_check", 0);
      return { raw: output.trim(), ok: true };
    }
  } catch (err) {
    // Non-zero exit means diagnostics were produced
    if (err.stdout || err.stderr) {
      const output = err.stdout || err.stderr;
      try {
        return JSON.parse(output);
      } catch {
        return { raw: output.trim(), ok: false, exitCode: err.code };
      }
    }

    return {
      error: err.message,
      ok: false,
    };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
