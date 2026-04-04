"use strict";

const redis = require("./redis-client");

/**
 * SSE connection registry backed by Redis.
 *
 * Tracks active SSE connections per IP/API key for enforcing connection limits.
 * Uses Redis hashes with TTL-based auto-cleanup: connections expire after 30
 * minutes without a heartbeat renewal.
 *
 * Key layout:
 *   conn:{connectionId}          — hash with metadata (ip, apiKey, connectedAt)
 *   conn-count:{groupKey}        — sorted set of connection IDs (score = expiry)
 *
 * Fail-open: if Redis is unavailable, operations succeed silently (connections
 * are allowed, counts return 0).
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
 *
 * @param {string} key - Group key (IP address or API key)
 * @returns {Promise<number>} - Number of active connections
 */
async function getConnectionCount(key) {
  let client;
  try {
    client = await redis.getClient();
  } catch (err) {
    console.warn("[connection-registry] Redis unavailable on count:", err.message);
    return 0;
  }

  try {
    const now = Date.now();
    const setKey = `conn-count:${key}`;

    // Remove expired connections (score < now)
    await client.zRemRangeByScore(setKey, 0, now);

    // Count remaining active connections
    return await client.zCard(setKey);
  } catch (err) {
    console.warn("[connection-registry] Redis count error:", err.message);
    return 0;
  }
}

module.exports = {
  CONNECTION_TTL_SEC,
  registerConnection,
  unregisterConnection,
  renewConnection,
  getConnectionCount,
};
