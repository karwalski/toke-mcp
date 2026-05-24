import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const TELEMETRY_DIR = join(homedir(), ".toke", "telemetry");

/** Telemetry is opt-in: set TOKE_TELEMETRY=1 to enable. */
export function isEnabled() {
  return process.env.TOKE_TELEMETRY === "1";
}

/** Replace string literal contents with "_" for privacy. */
export function stripStrings(source) {
  // Double-quoted strings: replace content between quotes (handles escaped quotes)
  return source.replace(/"(?:[^"\\]|\\.)*"/g, '"_"')
               .replace(/'(?:[^'\\]|\\.)*'/g, "'_'");
}

/** SHA-256 hex digest of the given text. */
function contentHash(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

let _dirReady = false;
let _knownHashes = null;

/** Ensure the telemetry directory exists and load known hashes for dedup. */
async function ensureDir() {
  if (_dirReady) return;
  await mkdir(TELEMETRY_DIR, { recursive: true });
  _dirReady = true;
}

/** Load existing file hashes from disk (lazy, one-time). */
async function loadKnownHashes() {
  if (_knownHashes) return _knownHashes;
  _knownHashes = new Set();
  try {
    const files = await readdir(TELEMETRY_DIR);
    for (const f of files) {
      // Filename format: <timestamp>-<hash>.tk
      const match = f.match(/-([a-f0-9]{64})\.tk$/);
      if (match) _knownHashes.add(match[1]);
    }
  } catch {
    // Directory may not exist yet, that's fine
  }
  return _knownHashes;
}

/**
 * Record source code that passed validation.
 * Writes asynchronously and never throws to the caller.
 *
 * @param {string} source   - Raw source code (before stripping)
 * @param {string} tool     - Tool name that produced/validated this code
 * @param {number} errorCount - Number of errors (should be 0 for recording)
 */
export function record(source, tool, errorCount = 0) {
  if (!isEnabled()) return;
  if (!source || typeof source !== "string" || source.trim().length === 0) return;
  if (errorCount > 0) return;

  // Fire-and-forget: async write, never block the caller
  _recordAsync(source, tool).catch(() => {
    // Silently ignore telemetry write failures
  });
}

async function _recordAsync(source, tool) {
  await ensureDir();

  const stripped = stripStrings(source);
  const hash = contentHash(stripped);

  // Deduplicate
  const known = await loadKnownHashes();
  if (known.has(hash)) return;

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}-${hash}.tk`;

  const metadata = [
    `## toke-telemetry`,
    `## timestamp: ${now.toISOString()}`,
    `## tool: ${tool}`,
    `## errors: 0`,
    `## hash: ${hash}`,
    ``,
  ].join("\n");

  await writeFile(join(TELEMETRY_DIR, filename), metadata + stripped, "utf-8");
  known.add(hash);
}
