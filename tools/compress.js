// STABLE API v1 - do not change schema without version bump
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execTkc } from "../lib/run-tkc.js";

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * toke_compress tool — compresses text using tkc --compress.
 *
 * Stable API v1: input, preserve_atoms → compressed, original_tokens, compressed_tokens, reduction_pct
 *
 * @param {string} input - Text to compress
 * @param {string[]} [preserve_atoms=[]] - Not supported by tkc: must be empty (see below)
 * @returns {Promise<object>}
 */
// toke 121.43 (9): tkc has no --preserve-atom flag (`tkc: unknown flag:
// --preserve-atom`, exit 3), so every call that passed a pattern failed after
// spawning tkc, with tkc's usage error as the only explanation.  The field
// stays in the frozen v1 schema; a non-empty list is refused here, before tkc
// runs, with an error that says why.
export const PRESERVE_ATOMS_UNSUPPORTED =
  "preserve_atoms is not supported: tkc --compress has no --preserve-atom option; pass an empty list or omit it";

export async function tokeCompress(input, preserve_atoms = []) {
  if (Array.isArray(preserve_atoms) && preserve_atoms.length > 0) {
    return { ok: false, error: PRESERVE_ATOMS_UNSUPPORTED };
  }
  const tmpFile = join(tmpdir(), `toke-compress-${randomUUID()}.txt`);

  try {
    await writeFile(tmpFile, input, "utf-8");

    const args = ["--compress", tmpFile];

    const { stdout } = await execTkc(TKC_PATH, args, { timeout: 30_000 });

    // tkc --compress emits JSON: { compressed, original_tokens, compressed_tokens }
    try {
      const result = JSON.parse(stdout);
      const original = result.original_tokens ?? 0;
      const compressed = result.compressed_tokens ?? 0;
      const reduction_pct =
        original > 0
          ? parseFloat(((1 - compressed / original) * 100).toFixed(1))
          : 0;
      return {
        compressed: result.compressed ?? stdout.trim(),
        original_tokens: original,
        compressed_tokens: compressed,
        reduction_pct,
      };
    } catch {
      // tkc returned plain text — estimate token counts (~4 chars/token)
      const compressed = stdout.trim();
      const original_tokens = Math.ceil(input.length / 4);
      const compressed_tokens = Math.ceil(compressed.length / 4);
      const reduction_pct =
        original_tokens > 0
          ? parseFloat(
              ((1 - compressed_tokens / original_tokens) * 100).toFixed(1)
            )
          : 0;
      return { compressed, original_tokens, compressed_tokens, reduction_pct };
    }
  } catch (err) {
    if (err.stdout || err.stderr) {
      const output = (err.stderr || err.stdout).trim();
      return { ok: false, error: output, exitCode: err.code };
    }
    return { ok: false, error: err.message };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

/**
 * toke_decompress tool — decompresses toke-compressed text using tkc --decompress.
 *
 * Stable API v1: input → decompressed
 *
 * @param {string} input - Compressed text to decompress
 * @returns {Promise<object>}
 */
export async function tokeDecompress(input) {
  const tmpFile = join(tmpdir(), `toke-decompress-${randomUUID()}.txt`);

  try {
    await writeFile(tmpFile, input, "utf-8");

    const { stdout } = await execTkc(
      TKC_PATH,
      ["--decompress", tmpFile],
      { timeout: 30_000 }
    );

    return { decompressed: stdout };
  } catch (err) {
    if (err.stdout || err.stderr) {
      const output = (err.stderr || err.stdout).trim();
      return { ok: false, error: output, exitCode: err.code };
    }
    return { ok: false, error: err.message };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
