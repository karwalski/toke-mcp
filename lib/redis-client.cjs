"use strict";

/**
 * Redis client stub — uses in-memory fallback when redis is not available.
 * Production SSE server uses real Redis; stdio/local mode uses this stub.
 */

let client = null;

async function getClient() {
  if (!client) {
    // In-memory mock for local/stdio mode
    const store = {};
    client = {
      isReady: true,
      get: async (key) => store[key] || null,
      set: async (key, val) => { store[key] = val; },
      incr: async (key) => { store[key] = (parseInt(store[key] || "0") + 1).toString(); return parseInt(store[key]); },
      expire: async () => {},
      del: async (key) => { delete store[key]; },
      quit: async () => { client = null; },
    };
  }
  return client;
}

async function disconnect() {
  if (client) { client = null; }
}

module.exports = { getClient, disconnect };
