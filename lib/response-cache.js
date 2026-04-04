"use strict";

const crypto = require("crypto");
const redis = require("./redis-client");

/**
 * Response cache backed by Redis.
 *
 * Cacheable tools (TTL 1 hour):
 *   - toke_spec_lookup
 *   - toke_explain_error
 *   - toke_stdlib_ref
 *
 * NOT cacheable (always fresh):
 *   - toke_check
 *   - toke_compile
 *
 * Key format: cache:{tool}:{sha256(input)}
 *
 * Fail-open: if Redis is unavailable, cache misses are returned (no error).
 */

/** Tools whose responses may be cached. */
const CACHEABLE_TOOLS = new Set([
  "toke_spec_lookup",
  "toke_explain_error",
  "toke_stdlib_ref",
]);

/** Default TTL for cached responses: 1 hour. */
const DEFAULT_TTL_SEC = 3600;

/**
 * Build a cache key from tool name and input.
 *
 * @param {string} tool  - Tool name (e.g. "toke_spec_lookup")
 * @param {*} input      - Input value (will be JSON-serialised for hashing)
 * @returns {string}     - Cache key
 */
function buildKey(tool, input) {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16); // 16 hex chars = 64 bits — sufficient for cache keys
  return `cache:${tool}:${hash}`;
}

/**
 * Get a cached response.
 *
 * @param {string} key - Cache key (use buildKey to construct)
 * @returns {Promise<*|null>} - Parsed cached value, or null on miss/error
 */
async function getCached(key) {
  let client;
  try {
    client = await redis.getClient();
  } catch (err) {
    console.warn("[response-cache] Redis unavailable on GET:", err.message);
    return null;
  }

  try {
    const raw = await client.get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[response-cache] Redis GET error:", err.message);
    return null;
  }
}

/**
 * Store a response in the cache.
 *
 * @param {string} key       - Cache key (use buildKey to construct)
 * @param {*}      value     - Value to cache (will be JSON-serialised)
 * @param {number} [ttlSec]  - TTL in seconds (default: 3600)
 * @returns {Promise<void>}
 */
async function setCached(key, value, ttlSec = DEFAULT_TTL_SEC) {
  let client;
  try {
    client = await redis.getClient();
  } catch (err) {
    console.warn("[response-cache] Redis unavailable on SET:", err.message);
    return;
  }

  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSec });
  } catch (err) {
    console.warn("[response-cache] Redis SET error:", err.message);
  }
}

module.exports = {
  CACHEABLE_TOOLS,
  DEFAULT_TTL_SEC,
  buildKey,
  getCached,
  setCached,
};
