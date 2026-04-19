import { writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * toke_migrate tool — accepts legacy 80-char syntax toke code, runs
 * tkc --migrate, returns the migrated 56-char default syntax source.
 */
export async function tokeMigrate(sourceCode) {
  const tmpFile = join(tmpdir(), `toke-migrate-${randomUUID()}.tk`);

  try {
    await writeFile(tmpFile, sourceCode, "utf-8");

    const { stdout, stderr } = await execFileAsync(
      TKC_PATH,
      ["--migrate", tmpFile],
      { timeout: 10_000 }
    );

    // tkc --migrate may write to stdout or modify the file in place
    const output = stdout.trim();
    if (output) {
      return { ok: true, migrated: output };
    }

    // If no stdout, the file was likely modified in place
    const migrated = await readFile(tmpFile, "utf-8");
    return { ok: true, migrated };
  } catch (err) {
    // Non-zero exit — extract diagnostics
    if (err.stdout || err.stderr) {
      const output = (err.stderr || err.stdout).trim();
      return { ok: false, error: output, exitCode: err.code };
    }

    return { ok: false, error: err.message };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
