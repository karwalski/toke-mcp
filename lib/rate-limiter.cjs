"use strict";

const redis = require("./redis-client.cjs");

/**
 * Sliding-window rate limiter using Redis sorted sets.
 *
 * Algorithm: each request adds a timestamped entry to a sorted set keyed by
 * the rate-limit bucket (e.g. IP address or API key). On each check, expired
 * entries outside the window are removed, and the remaining count determines
 * whether the request is allowed.
 *
 * Fail-closed (121.14): if the store is unavailable or errors, the request
 * is REFUSED -- { allowed: false, unavailable: true } -- and the caller
 * answers 503. This limiter is the public server's only guard against
 * unbounded tkc spawning (audit 120.15 TOK-01), so an outage of the thing
 * that counts must not become "count nothing". It used to fail open, and
 * until 132.72 the store threw on every call, so nothing was ever limited.
 */

/**
 * Check whether a request is within the rate limit.
 *
 * @param {string} key     - Rate limit bucket key (e.g. "rl:ip:1.2.3.4")
 * @param {number} limit   - Maximum number of requests allowed in the window
 * @param {number} windowSec - Window size in seconds
 * @returns {Promise<{allowed: boolean, remaining: number, retryAfter: number}>}
 */
async function checkRateLimit(key, limit, windowSec) {
  let client;
  try {
    client = await redis.getClient();
  } catch (err) {
    return unavailable(err, windowSec);
  }

  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = now - windowMs;
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

  try {
    // Atomic pipeline: clean expired entries, add new entry, count, set TTL
    const results = await client
      .multi()
      .zRemRangeByScore(key, 0, windowStart)    // Remove expired entries
      .zAdd(key, { score: now, value: member })  // Add current request
      .zCard(key)                                // Count entries in window
      .expire(key, windowSec + 1)                // Auto-cleanup TTL
      .exec();

    const count = results[2]; // zCard result
    if (typeof count !== "number" || !Number.isFinite(count)) throw new Error("store returned no count");
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);

    // If not allowed, calculate when the oldest entry in the window expires
    let retryAfter = 0;
    if (!allowed) {
      const oldest = await client.zRange(key, 0, 0, { REV: false });
      if (oldest.length > 0) {
        // Parse the timestamp from the member (format: "timestamp:random")
        const oldestTime = parseInt(oldest[0].split(":")[0], 10);
        retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000);
        if (retryAfter < 1) retryAfter = 1;
      }

      // Remove the entry we just added since the request is denied
      await client.zRem(key, member);
    }

    return { allowed, remaining, retryAfter };
  } catch (err) {
    return unavailable(err, windowSec);
  }
}

/** The store failed: refuse, and suggest a short retry. */
function unavailable(err, windowSec) {
  console.warn("[rate-limiter] store error, refusing the request:", err && err.message);
  return { allowed: false, remaining: 0, retryAfter: Math.min(60, Math.max(1, windowSec)), unavailable: true };
}

module.exports = { checkRateLimit };
