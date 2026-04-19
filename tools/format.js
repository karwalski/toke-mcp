/**
 * toke_format tool — auto-format toke source code.
 *
 * Attempts tkc --fmt first; falls back to a JS-based formatter that enforces
 * consistent indentation, spacing, semicolons, and blank-line normalisation.
 */

import { writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TKC_PATH = process.env.TKC_PATH || "tkc";

/**
 * JS-based formatter fallback. Applies basic formatting rules to toke source.
 */
function jsFormat(source) {
  const lines = source.split("\n");
  let depth = 0;
  const formatted = [];
  let consecutiveBlanks = 0;

  for (const rawLine of lines) {
    let line = rawLine.trimEnd();

    // Normalise blank lines (max 2 consecutive)
    if (line.trim() === "") {
      consecutiveBlanks++;
      if (consecutiveBlanks <= 2) {
        formatted.push("");
      }
      continue;
    }
    consecutiveBlanks = 0;

    const stripped = line.trim();

    // Decrease depth before indenting for closing braces/parens
    if (/^[}\])]+[;,]?$/.test(stripped)) {
      depth = Math.max(0, depth - 1);
    }

    // Normalise spacing around common operators ( =, ==, !=, <=, >=, +, -, *, / )
    // but avoid mangling string literals, comments, or sigils
    let result = stripped;

    // Only apply operator spacing outside of strings and comments
    if (!stripped.startsWith("//") && !stripped.startsWith("#")) {
      // Space around assignment and comparison operators
      result = result.replace(/\s*(===|!==|==|!=|<=|>=|=>|[+\-*/%]=)\s*/g, " $1 ");
      // Space around single = but not ==, !=, <=, >=, =>
      result = result.replace(/(?<!=)(?<!!)(?<!>)(?<!<)=(?!=|>)/g, " = ");
      // Clean up any double spaces introduced
      result = result.replace(/ {2,}/g, " ");
      result = result.trim();
    }

    // Ensure semicolons after statements (skip lines ending with {, }, //, or commas)
    if (
      !result.endsWith(";") &&
      !result.endsWith("{") &&
      !result.endsWith("}") &&
      !result.endsWith(",") &&
      !result.endsWith("(") &&
      !result.endsWith(")") &&
      !result.startsWith("//") &&
      !result.startsWith("#") &&
      !result.startsWith("*") &&
      !result.startsWith("/*") &&
      !result.endsWith("*/") &&
      !result.startsWith("@") &&
      !/^(if|else|for|while|fn|func|match|struct|enum|impl|mod|use|pub|import)\b/.test(result) &&
      result.length > 0
    ) {
      // Only add semicolons to what looks like a statement
      if (/^(let|var|const|return|yield|break|continue)\b/.test(result) ||
          /^[$#%@&]?\w+.*[^{(,]$/.test(result)) {
        result += ";";
      }
    }

    // Apply indentation
    formatted.push("  ".repeat(depth) + result);

    // Increase depth after opening braces
    if (stripped.endsWith("{") && !stripped.startsWith("//")) {
      depth++;
    }
  }

  // Remove trailing blank lines, ensure single newline at end
  while (formatted.length > 0 && formatted[formatted.length - 1] === "") {
    formatted.pop();
  }
  formatted.push("");

  return formatted.join("\n");
}

/**
 * Format toke source code. Tries tkc --fmt first, falls back to JS formatter.
 */
export async function tokeFormat(sourceCode) {
  const tmpFile = join(tmpdir(), `toke-format-${randomUUID()}.tk`);

  try {
    await writeFile(tmpFile, sourceCode, "utf-8");

    // Try tkc --fmt first
    try {
      await execFileAsync(TKC_PATH, ["--fmt", tmpFile], { timeout: 10_000 });
      const formatted = await readFile(tmpFile, "utf-8");
      return { ok: true, formatted, engine: "tkc" };
    } catch {
      // tkc --fmt not available or failed — use JS fallback
    }

    const formatted = jsFormat(sourceCode);
    return { ok: true, formatted, engine: "js-fallback" };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
