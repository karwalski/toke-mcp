import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * toke_companion tool — generates, verifies, or diffs companion file skeletons.
 *
 * Modes:
 *   "generate" — run tkc --companion on source, return .tkc.md skeleton
 *   "verify"   — run tkc --verify-companion on companion, check hash match
 *   "diff"     — run tkc --companion-diff, compare companion vs source
 */
export async function tokeCompanion(source, mode = "generate", companion) {
  const id = randomUUID();
  const tmpSource = join(tmpdir(), `toke-companion-${id}.tk`);
  const tmpCompanion = join(tmpdir(), `toke-companion-${id}.tkc.md`);

  try {
    await writeFile(tmpSource, source, "utf-8");

    if (mode === "generate") {
      const { stdout } = await execFileAsync(
        TKC_PATH,
        ["--companion", tmpSource],
        { timeout: 10_000 }
      );

      return { ok: true, companion: stdout };
    }

    if (mode === "verify") {
      if (!companion) {
        return { ok: false, error: "companion content is required for verify mode" };
      }

      await writeFile(tmpCompanion, companion, "utf-8");

      const { stdout, stderr } = await execFileAsync(
        TKC_PATH,
        ["--verify-companion", tmpCompanion],
        { timeout: 10_000 }
      );

      return { ok: true, match: true, output: (stdout || stderr).trim() };
    }

    if (mode === "diff") {
      if (!companion) {
        return { ok: false, error: "companion content is required for diff mode" };
      }

      await writeFile(tmpCompanion, companion, "utf-8");

      const { stdout, stderr } = await execFileAsync(
        TKC_PATH,
        ["--companion-diff", tmpCompanion, tmpSource],
        { timeout: 10_000 }
      );

      return { ok: true, divergences: false, output: (stdout || stderr).trim() };
    }

    return { ok: false, error: `unknown mode: ${mode}` };
  } catch (err) {
    // Non-zero exit from verify means hash mismatch
    if (mode === "verify" && err.code != null) {
      return {
        ok: true,
        match: false,
        output: (err.stdout || err.stderr || "").trim(),
      };
    }

    // Non-zero exit from diff means divergences found
    if (mode === "diff" && err.code != null) {
      return {
        ok: true,
        divergences: true,
        output: (err.stdout || err.stderr || "").trim(),
      };
    }

    // For generate or unexpected errors
    if (err.stdout || err.stderr) {
      const output = err.stderr || err.stdout;
      return { ok: false, error: output.trim(), exitCode: err.code };
    }

    return { ok: false, error: err.message };
  } finally {
    await unlink(tmpSource).catch(() => {});
    await unlink(tmpCompanion).catch(() => {});
  }
}
