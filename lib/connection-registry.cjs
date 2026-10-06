"use strict";

const redis = require("./redis-client.cjs");

/**
 * SSE connection registry over the in-process store (redis-client.cjs), so
 * connection counts are PER PROCESS (132.75, README "Rate limits are per
 * process").
 *
 * Tracks active SSE connections per IP/API key for enforcing connection limits.
 * Uses Redis-style hashes with TTL-based auto-cleanup: connections expire after 30
 * minutes without a heartbeat renewal.
 *
 * Key layout:
 *   conn:{connectionId}          — hash with metadata (ip, apiKey, connectedAt)
 *   conn-count:{groupKey}        — sorted set of connection IDs (score = expiry)
 *
 * Fail-closed (121.14): getConnectionCount THROWS when the store is
 * unavailable, and the connection-limit middleware refuses the connection
 * (503). It used to return 0 -- "no connections" -- which allowed every new
 * SSE connection whenever the store failed. register/renew/unregister still
 * log and continue: a failed bookkeeping write cannot be undone by refusing
 * a connection that is already open.
 */

/** Connection TTL: 30 minutes without heartbeat. */
const CONNECTION_TTL_SEC = 30 * 60;

/**
 * Register a new SSE connection.
 *
 * @param {string} id        - Unique connection ID
 * @param {object} metadata  - Connection metadata
 * @param {string} metadata.ip      - Client IP address
 * @param {string} [metadata.apiKey] - API key (if authenticated)
 * @returns {Promise<void>}
 */
async function registerConnection(id, metadata) {
  let client;
  try {
    client = await redis.getClient();
  } catch (err) {
    console.warn("[connection-registry] Redis unavailable on register:", err.message);
    return;
  }

  const now = Date.now();
  const expiresAt = now + CONNECTION_TTL_SEC * 1000;
  const groupKey = metadata.apiKey || metadata.ip;

  try {
    await client
      .multi()
      // Store connection metadata
      .hSet(`conn:${id}`, {
        ip: metadata.ip,
        apiKey: metadata.apiKey || "",
        connectedAt: String(now),
        groupKey,
      })
      .expire(`conn:${id}`, CONNECTION_TTL_SEC)
      // Add to group's connection set (score = expiry timestamp)
      .zAdd(`conn-count:${groupKey}`, { score: expiresAt, value: id })
      .expire(`conn-count:${groupKey}`, CONNECTION_TTL_SEC + 60)
      .exec();
  } catch (err) {
    console.warn("[connection-registry] Redis register error:", err.message);
  }
}

/**
 * Unregister an SSE connection (on disconnect).
 *
 * @param {string} id - Connection ID to remove
 * @returns {Promise<void>}
 */
async function unregisterConnection(id) {
  let client;
  try {
    client = await redis.getClient();
  } catch (err) {
    console.warn("[connection-registry] Redis unavailable on unregister:", err.message);
    return;
  }

  try {
    // Look up the group key before deleting
    const groupKey = await client.hGet(`conn:${id}`, "groupKey");

    await client
      .multi()
      .del(`conn:${id}`)
      .zRem(`conn-count:${groupKey || "__unknown__"}`, id)
      .exec();
  } catch (err) {
    console.warn("[connection-registry] Redis unregister error:", err.message);
  }
}

/**
 * Renew a connection's TTL (heartbeat).
 *
 * @param {string} id - Connection ID to renew
 * @returns {Promise<void>}
 */
async function renewConnection(id) {
  let client;
  try {
    client = await redis.getClient();
  } catch (err) {
    console.warn("[connection-registry] Redis unavailable on renew:", err.message);
    return;
  }

  try {
    const groupKey = await client.hGet(`conn:${id}`, "groupKey");
    if (!groupKey) return; // Connection not found — already expired

    const expiresAt = Date.now() + CONNECTION_TTL_SEC * 1000;

    await client
      .multi()
      .expire(`conn:${id}`, CONNECTION_TTL_SEC)
      .zAdd(`conn-count:${groupKey}`, { score: expiresAt, value: id })
      .expire(`conn-count:${groupKey}`, CONNECTION_TTL_SEC + 60)
      .exec();
  } catch (err) {
    console.warn("[connection-registry] Redis renew error:", err.message);
  }
}

/**
 * Get the number of active connections for a group key (IP or API key).
 *
 * Expired entries (past their TTL) are cleaned up before counting.
 * Throws when the store fails (fail-closed, 121.14).
 *
 * @param {string} key - Group key (IP address or API key)
 * @returns {Promise<number>} - Number of active connections
 */
async function getConnectionCount(key) {
  const client = await redis.getClient();         // throws: caller refuses
  const now = Date.now();
  const setKey = `conn-count:${key}`;

  // Remove expired connections (score < now)
  await client.zRemRangeByScore(setKey, 0, now);

  // Count remaining active connections
  const n = await client.zCard(setKey);
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("store returned no count");
  return n;
}

module.exports = {
  CONNECTION_TTL_SEC,
  registerConnection,
  unregisterConnection,
  renewConnection,
  getConnectionCount,
};
