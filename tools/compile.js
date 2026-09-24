import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { record } from "../lib/telemetry.js";
import { parseTkcDiagnostics } from "../lib/tkc-diagnostics.js";

const execFileAsync = promisify(execFile);

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * toke_compile tool — accepts Toke source code, runs tkc --emit-llvm,
 * returns LLVM IR string on success or JSON diagnostics on error.
 *
 * tkc emits JSON Lines diagnostics on stderr whenever stderr is not a tty
 * (132.81): `diagnostics` is always an array holding every one of them.
 * When tkc fails without any JSON line, its text is returned as `error`.
 */
export async function tokeCompile(sourceCode) {
  const tmpFile = join(tmpdir(), `toke-compile-${randomUUID()}.tk`);

  try {
    await writeFile(tmpFile, sourceCode, "utf-8");

    const { stdout, stderr } = await execFileAsync(
      TKC_PATH,
      ["--emit-llvm", tmpFile],
      { timeout: 10_000 }
    );

    record(sourceCode, "toke_compile", 0);
    // Warnings, if any, arrive on stderr; the IR is stdout.
    return { ok: true, llvm_ir: stdout, diagnostics: parseTkcDiagnostics(stderr).diagnostics };
  } catch (err) {
    // Compilation failed — extract every diagnostic
    if (err.stdout || err.stderr) {
      const { diagnostics, raw } = parseTkcDiagnostics(err.stderr, err.stdout);
      if (diagnostics.length > 0) return { ok: false, diagnostics, exitCode: err.code };
      return { ok: false, diagnostics: [], error: raw, exitCode: err.code };
    }

    return { ok: false, diagnostics: [], error: err.message };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
