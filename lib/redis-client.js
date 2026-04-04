"use strict";

const { createClient } = require("redis");

/**
 * Shared Redis client singleton for Lambda functions.
 *
 * Connection details are read from environment variables:
 *   REDIS_HOST — ElastiCache primary endpoint address
 *   REDIS_PORT — port (default 6379)
 *
 * TLS is enabled by default (ElastiCache transit encryption).
 *
 * The client is lazily created on first call to getClient() and reused
 * across warm Lambda invocations.
 */

let client = null;

/**
 * Get (or create) the shared Redis client.
 *
 * @returns {Promise<import("redis").RedisClientType>}
 * @throws {Error} if REDIS_HOST is not set or connection fails
 */
async function getClient() {
  if (client && client.isReady) {
    return client;
  }

  const host = process.env.REDIS_HOST;
  if (!host) {
    throw new Error("REDIS_HOST environment variable is not set");
  }

  const port = parseInt(process.env.REDIS_PORT || "6379", 10);

  client = createClient({
    socket: {
      host,
      port,
      tls: true,
      connectTimeout: 3000,
      reconnectStrategy: (retries) => {
        if (retries > 3) return new Error("Redis reconnect limit reached");
        return Math.min(retries * 200, 1000);
      },
    },
  });

  client.on("error", (err) => {
    console.warn("[redis-client] Connection error:", err.message);
  });

  await client.connect();
  return client;
}

/**
 * Disconnect the Redis client (for graceful shutdown in tests).
 */
async function disconnect() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getClient, disconnect };
