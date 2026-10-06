"use strict";

const { checkRateLimit } = require("./rate-limiter.cjs");
const { getConnectionCount } = require("./connection-registry.cjs");

/**
 * Simplified rate-limit middleware for self-hosted toke-mcp.
 *
 * Uses flat configuration via environment variables or a config object.
 * No tiers, no auth, no billing -- just straightforward per-IP rate limiting.
 * The limits are per process (132.75): each instance counts on its own.
 *
 * Environment variables:
 *   RATE_LIMIT_PER_HOUR    - Max requests per hour per IP (default: 100)
 *   RATE_LIMIT_WINDOW_SEC  - Sliding window size in seconds (default: 3600)
 *   MAX_CONNECTIONS         - Max concurrent SSE connections per IP (default: 5)
 */

/**
 * A positive integer from the environment, or the default (121.14). A value
 * that does not parse used to become NaN, and `count >= NaN` is false, so
 * MAX_CONNECTIONS=five meant "no connection limit at all".
 */
function positiveIntEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return dflt;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  console.warn(`[rate-limit] ${name}=${JSON.stringify(raw)} is not a positive integer; using ${dflt}`);
  return dflt;
}

const DEFAULT_LIMIT = positiveIntEnv("RATE_LIMIT_PER_HOUR", 100);
const DEFAULT_WINDOW = positiveIntEnv("RATE_LIMIT_WINDOW_SEC", 3600);
const DEFAULT_MAX_CONN = positiveIntEnv("MAX_CONNECTIONS", 5);

/** Bucket for any tool name the server does not register (121.14). */
const OTHER_TOOL = "__other__";

/** 503 body for a limit that cannot be checked (fail-closed, 121.14). */
function unavailableBody(what) {
  return JSON.stringify({
    error: "limit_unavailable",
    message: `The ${what} limit cannot be checked right now, so the request is refused. Try again shortly.`,
  });
}

/**
 * Check whether a tool call is allowed under rate limits.
 *
 * @param {object} params
 * @param {string} params.tool       - Tool name being invoked
 * @param {string} params.clientIp   - Client IP address
 * @param {object} [params.config]   - Optional override: { limit, windowSec }
 * @param {Set<string>} [params.knownTools] - The tool names the server
 *   registers. Any other name is counted in one shared bucket per IP: the
 *   name is client-chosen, and a bucket per name meant a fresh, unlimited
 *   bucket for every new name (121.14).
 * @returns {Promise<{
 *   allowed: boolean,
 *   headers: Record<string, string>,
 *   statusCode?: number,
 *   body?: string
 * }>}
 */
async function checkToolRateLimit({ tool, clientIp, config, knownTools }) {
  const limit = (config && config.limit) || DEFAULT_LIMIT;
  const windowSec = (config && config.windowSec) || DEFAULT_WINDOW;
  const bucket = knownTools && !knownTools.has(tool) ? OTHER_TOOL : tool;
  const key = `ratelimit:${clientIp}:${bucket}`;

  const result = await checkRateLimit(key, limit, windowSec);

  if (result.unavailable) {
    return {
      allowed: false,
      headers: { "Retry-After": String(result.retryAfter) },
      statusCode: 503,
      body: unavailableBody("rate"),
    };
  }

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
  let count;
  try {
    count = await getConnectionCount(clientIp);
  } catch (err) {
    console.warn("[rate-limit] connection count unavailable, refusing the connection:", err && err.message);
    return { allowed: false, statusCode: 503, body: unavailableBody("connection") };
  }

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

module.exports = { checkToolRateLimit, checkConnectionLimit, OTHER_TOOL };
