import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * toke_compile tool — accepts Toke source code, runs tkc --emit-llvm,
 * returns LLVM IR string on success or JSON diagnostics on error.
 */
export async function tokeCompile(sourceCode) {
  const tmpFile = join(tmpdir(), `toke-compile-${randomUUID()}.tk`);

  try {
    await writeFile(tmpFile, sourceCode, "utf-8");

    const { stdout } = await execFileAsync(
      TKC_PATH,
      ["--emit-llvm", tmpFile],
      { timeout: 10_000 }
    );

    return { ok: true, llvm_ir: stdout };
  } catch (err) {
    // Compilation failed — try to extract diagnostics
    if (err.stdout || err.stderr) {
      const diagOutput = err.stderr || err.stdout;

      // Try parsing as JSON diagnostics (if tkc was invoked with --diag-json
      // internally, or produces structured output on error)
      try {
        return { ok: false, diagnostics: JSON.parse(diagOutput) };
      } catch {
        return { ok: false, error: diagOutput.trim(), exitCode: err.code };
      }
    }

    return { ok: false, error: err.message };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
