// STABLE API v1 - do not change schema without version bump
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * toke_compress tool — compresses text using tkc --compress.
 *
 * Stable API v1: input, preserve_atoms → compressed, original_tokens, compressed_tokens, reduction_pct
 *
 * @param {string} input - Text to compress
 * @param {string[]} [preserve_atoms=[]] - Regex patterns for tokens to preserve unchanged
 * @returns {Promise<object>}
 */
export async function tokeCompress(input, preserve_atoms = []) {
  const tmpFile = join(tmpdir(), `toke-compress-${randomUUID()}.txt`);

  try {
    await writeFile(tmpFile, input, "utf-8");

    const args = ["--compress", tmpFile];
    for (const pattern of preserve_atoms) {
      args.push("--preserve-atom", pattern);
    }

    const { stdout } = await execFileAsync(TKC_PATH, args, { timeout: 30_000 });

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

    const { stdout } = await execFileAsync(
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
