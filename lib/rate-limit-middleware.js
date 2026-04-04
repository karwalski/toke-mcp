"use strict";

const { checkRateLimit } = require("./rate-limiter");
const { getConnectionCount } = require("./connection-registry");

/**
 * Simplified rate-limit middleware for self-hosted toke-mcp.
 *
 * Uses flat configuration via environment variables or a config object.
 * No tiers, no auth, no billing -- just straightforward per-IP rate limiting.
 *
 * Environment variables:
 *   RATE_LIMIT_PER_HOUR    - Max requests per hour per IP (default: 100)
 *   RATE_LIMIT_WINDOW_SEC  - Sliding window size in seconds (default: 3600)
 *   MAX_CONNECTIONS         - Max concurrent SSE connections per IP (default: 5)
 */

const DEFAULT_LIMIT = parseInt(process.env.RATE_LIMIT_PER_HOUR || "100", 10);
const DEFAULT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_SEC || "3600", 10);
const DEFAULT_MAX_CONN = parseInt(process.env.MAX_CONNECTIONS || "5", 10);

/**
 * Check whether a tool call is allowed under rate limits.
 *
 * @param {object} params
 * @param {string} params.tool       - Tool name being invoked
 * @param {string} params.clientIp   - Client IP address
 * @param {object} [params.config]   - Optional override: { limit, windowSec }
 * @returns {Promise<{
 *   allowed: boolean,
 *   headers: Record<string, string>,
 *   statusCode?: number,
 *   body?: string
 * }>}
 */
async function checkToolRateLimit({ tool, clientIp, config }) {
  const limit = (config && config.limit) || DEFAULT_LIMIT;
  const windowSec = (config && config.windowSec) || DEFAULT_WINDOW;
  const key = `ratelimit:${clientIp}:${tool}`;

  const result = await checkRateLimit(key, limit, windowSec);

  const resetTime = Math.ceil(Date.now() / 1000) + windowSec;
  const headers = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(resetTime),
  };

  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfter);
    return {
      allowed: false,
      headers,
      statusCode: 429,
      body: JSON.stringify({
        error: "rate_limit_exceeded",
        message: `Rate limit exceeded for ${tool}. Try again in ${result.retryAfter} seconds.`,
        retryAfter: result.retryAfter,
      }),
    };
  }

  return { allowed: true, headers };
}

/**
 * Check whether a new SSE connection is allowed.
 *
 * @param {object} params
 * @param {string} params.clientIp   - Client IP address
 * @param {object} [params.config]   - Optional override: { maxConnections }
 * @returns {Promise<{ allowed: boolean, statusCode?: number, body?: string }>}
 */
async function checkConnectionLimit({ clientIp, config }) {
  const maxConn = (config && config.maxConnections) || DEFAULT_MAX_CONN;
  const count = await getConnectionCount(clientIp);

  if (count >= maxConn) {
    return {
      allowed: false,
      statusCode: 429,
      body: JSON.stringify({
        error: "connection_limit_exceeded",
        message: `Maximum ${maxConn} concurrent SSE connections per IP`,
      }),
    };
  }

  return { allowed: true };
}

module.exports = { checkToolRateLimit, checkConnectionLimit };
