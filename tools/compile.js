import { writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execTkc } from "../lib/run-tkc.js";
import { record } from "../lib/telemetry.js";
import { parseTkcDiagnostics } from "../lib/tkc-diagnostics.js";

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * toke_compile tool — accepts Toke source code, runs tkc --emit-llvm,
 * returns LLVM IR string on success or JSON diagnostics on error.
 *
 * tkc emits JSON Lines diagnostics on stderr whenever stderr is not a tty
 * (132.81): `diagnostics` is always an array holding every one of them.
 * When tkc fails without any JSON line, its text is returned as `error`.
 *
 * tkc --emit-llvm writes the IR to a file (by default `<stem>.ll` in the
 * current directory), never to stdout: name that file with --out, read it,
 * and delete it (132.84 found `llvm_ir` always empty and one stray .ll left
 * in the server's working directory per call).
 */
export async function tokeCompile(sourceCode) {
  const id = randomUUID();
  const tmpFile = join(tmpdir(), `toke-compile-${id}.tk`);
  const outFile = join(tmpdir(), `toke-compile-${id}.ll`);

  try {
    await writeFile(tmpFile, sourceCode, "utf-8");

    const { stderr } = await execTkc(
      TKC_PATH,
      ["--emit-llvm", "--out", outFile, tmpFile],
      { timeout: 10_000 }
    );
    const llvm_ir = await readFile(outFile, "utf-8");

    record(sourceCode, "toke_compile", 0);
    // Warnings, if any, arrive on stderr.
    return { ok: true, llvm_ir, diagnostics: parseTkcDiagnostics(stderr).diagnostics };
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
    await unlink(outFile).catch(() => {});
  }
}
