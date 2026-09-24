/**
 * Parse tkc's structured diagnostics (132.81).
 *
 * tkc writes diagnostics as JSON Lines: one JSON object per line, one line
 * per diagnostic. tkc 3.0.0 writes them to stderr and leaves stdout empty for
 * `--check`; JSON is the default whenever stderr is not a tty, so
 * `--emit-llvm` failures arrive in the same shape. Warnings (e.g. W1020)
 * arrive the same way with exit code 0.
 *
 * `JSON.parse` over the whole stream only succeeds when there is exactly one
 * line, which is how a lone diagnostic used to come back as a bare object
 * and two or more as an unparsed string. Parse line by line instead.
 *
 * @param {...string} streams - tkc's output streams (stderr, stdout), in any order
 * @returns {{ diagnostics: object[], raw: string }} every JSON object line, in
 *   order, and whatever non-JSON text remained (trimmed; "" if none)
 */
export function parseTkcDiagnostics(...streams) {
  const diagnostics = [];
  const rest = [];
  for (const stream of streams) {
    if (!stream) continue;
    for (const line of String(stream).split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("{")) {
        try {
          const d = JSON.parse(t);
          if (d && typeof d === "object" && !Array.isArray(d)) {
            diagnostics.push(d);
            continue;
          }
        } catch {
          // not JSON — keep it as text below
        }
      }
      rest.push(line);
    }
  }
  return { diagnostics, raw: rest.join("\n").trim() };
}

/** True when any parsed diagnostic is an error (not a warning). */
export function hasErrorDiagnostic(diagnostics) {
  return diagnostics.some((d) => d.severity !== "warning");
}

/**
 * The diagnostics a caller should report for a tokeCheck() result: every
 * parsed diagnostic, plus the run failure (`error`) or, for a failed check,
 * any non-JSON text tkc printed. Whether the check passed is `result.ok` —
 * never infer it from this list being empty: tkc can fail without printing.
 */
export function checkResultDiagnostics(result) {
  const out = [...(Array.isArray(result.diagnostics) ? result.diagnostics : [])];
  if (result.error) out.push({ message: result.error });
  else if (!result.ok && result.raw) out.push({ message: result.raw });
  return out;
}
