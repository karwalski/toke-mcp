"use strict";

const redis = require("./redis-client");

/**
 * Sliding-window rate limiter using Redis sorted sets.
 *
 * Algorithm: each request adds a timestamped entry to a sorted set keyed by
 * the rate-limit bucket (e.g. IP address or API key). On each check, expired
 * entries outside the window are removed, and the remaining count determines
 * whether the request is allowed.
 *
 * Fail-open: if Redis is unavailable, all requests are allowed with a warning
 * log. This prevents Redis outages from taking down the entire service.
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
    console.warn("[rate-limiter] Redis unavailable, failing open:", err.message);
    return { allowed: true, remaining: limit, retryAfter: 0 };
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
    console.warn("[rate-limiter] Redis error, failing open:", err.message);
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}

module.exports = { checkRateLimit };
