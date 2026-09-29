"use strict";

/**
 * In-process store with the subset of the node-redis v4 API that
 * rate-limiter.cjs, connection-registry.cjs and response-cache.cjs call.
 *
 * There is no Redis connection: REDIS_URL is not read, and limits are held in
 * this process's memory, so they are per-process and reset on restart. Until
 * 132.72 this stub implemented only get/set/incr/expire/del, so every call the
 * rate limiter and connection registry made (multi, hSet, hGet, zAdd, zRem,
 * zRemRangeByScore, zCard, zRange) threw, was caught, and "failed open": no
 * tool rate limit and no connection limit was ever enforced.
 *
 * Bounded (121.14). Expired keys used to be dropped only when that same key
 * was read again, so keys nobody read again -- one per client IP, and one
 * per client-chosen tool name -- stayed forever, and the map grew without
 * limit. Now every SWEEP_EVERY writes sweep the expired keys out, and a
 * write that would create a key past STORE_MAX_KEYS (default 100000) throws
 * "store full". The rate limiter and connection limit treat a throwing store
 * as "refuse" (fail-closed), so a full store denies new work instead of
 * exhausting memory.
 */

let client = null;

const SWEEP_EVERY = 1000;

function maxKeys() {
  const n = Number(process.env.STORE_MAX_KEYS);
  return Number.isInteger(n) && n > 0 ? n : 100000;
}

function createStore() {
  const data = new Map();    // key -> string | Map (hash) | Map (sorted set: member -> score)
  const expiry = new Map();  // key -> epoch ms
  const cap = maxKeys();
  let writes = 0;

  function sweep() {
    const now = Date.now();
    for (const [key, at] of expiry) {
      if (at <= now) { data.delete(key); expiry.delete(key); }
    }
  }

  /* Called before any write that may create `key`. */
  function claim(key) {
    if (++writes % SWEEP_EVERY === 0) sweep();
    if (live(key) !== undefined || data.size < cap) return;
    sweep();
    if (data.size >= cap) throw new Error(`store full (${cap} keys)`);
  }

  function live(key) {
    const at = expiry.get(key);
    if (at !== undefined && at <= Date.now()) {
      data.delete(key);
      expiry.delete(key);
    }
    return data.get(key);
  }

  function zset(key, create) {
    let z = live(key);
    if (z === undefined && create) { z = new Map(); data.set(key, z); }
    return z;
  }

  const ops = {
    get: (key) => { const v = live(key); return typeof v === "string" ? v : null; },
    set: (key, val, opts) => {
      claim(key);
      data.set(key, String(val));
      if (opts && opts.EX) expiry.set(key, Date.now() + opts.EX * 1000);
      else expiry.delete(key);
      return "OK";
    },
    incr: (key) => {
      claim(key);
      const n = parseInt(live(key) || "0", 10) + 1;
      data.set(key, String(n));
      return n;
    },
    expire: (key, sec) => {
      if (live(key) === undefined) return 0;
      expiry.set(key, Date.now() + sec * 1000);
      return 1;
    },
    del: (key) => { const had = live(key) !== undefined; data.delete(key); expiry.delete(key); return had ? 1 : 0; },
    hSet: (key, fields) => {
      claim(key);
      let h = live(key);
      if (!(h instanceof Map)) { h = new Map(); data.set(key, h); }
      let added = 0;
      for (const [f, v] of Object.entries(fields)) { if (!h.has(f)) added++; h.set(f, String(v)); }
      return added;
    },
    hGet: (key, field) => { const h = live(key); return h instanceof Map && h.has(field) ? h.get(field) : null; },
    zAdd: (key, { score, value }) => {
      claim(key);
      const z = zset(key, true);
      const added = z.has(value) ? 0 : 1;
      z.set(value, Number(score));
      return added;
    },
    zRem: (key, member) => { const z = zset(key, false); return z && z.delete(member) ? 1 : 0; },
    zRemRangeByScore: (key, min, max) => {
      const z = zset(key, false);
      if (!z) return 0;
      let n = 0;
      for (const [m, s] of z) if (s >= min && s <= max) { z.delete(m); n++; }
      return n;
    },
    zCard: (key) => { const z = zset(key, false); return z ? z.size : 0; },
    zRange: (key, start, stop) => {
      const z = zset(key, false);
      if (!z) return [];
      const members = [...z.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
      const end = stop < 0 ? members.length + stop : stop;
      return members.slice(start, end + 1);
    },
  };

  const api = { isReady: true };
  for (const [name, fn] of Object.entries(ops)) api[name] = async (...args) => fn(...args);
  api.multi = () => {
    const queue = [];
    const chain = {
      exec: async () => queue.map(([name, args]) => ops[name](...args)),
    };
    for (const name of Object.keys(ops)) {
      chain[name] = (...args) => { queue.push([name, args]); return chain; };
    }
    return chain;
  };
  api.quit = async () => { client = null; };
  api.size = () => data.size;              /* for tests */
  return api;
}

async function getClient() {
  if (!client) client = createStore();
  return client;
}

async function disconnect() {
  client = null;
}

module.exports = { getClient, disconnect };
