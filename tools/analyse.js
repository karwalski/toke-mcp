import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TKC_PATH = process.env.TKC_PATH || "tkc";

const SUPPORTED_TOKENIZERS = ["cl100k_base", "o200k_base", "toke-bpe"];

/**
 * Heuristic schema detection — categorise input as json, csv, or prose.
 *
 * @param {string} input
 * @returns {"json"|"csv"|"prose"}
 */
function detectSchema(input) {
  const trimmed = input.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(input);
      return "json";
    } catch {
      // falls through to csv/prose check
    }
  }

  // CSV: first non-empty line has multiple comma-separated fields, and
  // at least half of subsequent lines match the same column count.
  const lines = input.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length >= 2) {
    const firstCols = lines[0].split(",").length;
    if (firstCols >= 2) {
      const matchingLines = lines.filter(
        (l) => l.split(",").length === firstCols
      );
      if (matchingLines.length / lines.length >= 0.5) {
        return "csv";
      }
    }
  }

  return "prose";
}

/**
 * toke_analyse tool — pre-flight token budget estimation.
 *
 * Does NOT compress the input. Calls tkc --analyse with tokenizer selection
 * and returns raw/estimated compressed token counts and schema classification.
 *
 * @param {string} input - Text to analyse
 * @param {string} [tokenizer="cl100k_base"] - Tokenizer to use
 * @returns {Promise<object>}
 */
export async function tokeAnalyse(input, tokenizer = "cl100k_base") {
  const effectiveTokenizer = SUPPORTED_TOKENIZERS.includes(tokenizer)
    ? tokenizer
    : "cl100k_base";

  const tmpFile = join(tmpdir(), `toke-analyse-${randomUUID()}.txt`);

  try {
    await writeFile(tmpFile, input, "utf-8");

    const { stdout } = await execFileAsync(
      TKC_PATH,
      ["--analyse", "--tokenizer", effectiveTokenizer, tmpFile],
      { timeout: 30_000 }
    );

    // tkc --analyse emits JSON: { raw_tokens, est_compressed_tokens }
    try {
      const result = JSON.parse(stdout);
      const raw_tokens = result.raw_tokens ?? 0;
      const est_compressed_tokens = result.est_compressed_tokens ?? 0;
      const reduction_pct =
        raw_tokens > 0
          ? parseFloat(
              ((1 - est_compressed_tokens / raw_tokens) * 100).toFixed(1)
            )
          : 0;
      return {
        raw_tokens,
        est_compressed_tokens,
        reduction_pct,
        tokenizer: effectiveTokenizer,
        schema_detected: result.schema_detected ?? detectSchema(input),
      };
    } catch {
      // Fallback: estimate from character counts (~4 chars/token for cl100k_base)
      const raw_tokens = Math.ceil(input.length / 4);
      const schema_detected = detectSchema(input);
      // Conservative 12.5% reduction estimate (Gate 1 measured baseline)
      const est_compressed_tokens = Math.ceil(raw_tokens * 0.875);
      const reduction_pct = 12.5;
      return {
        raw_tokens,
        est_compressed_tokens,
        reduction_pct,
        tokenizer: effectiveTokenizer,
        schema_detected,
      };
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
