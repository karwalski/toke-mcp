// 121.26 (audit 120.15 TOK-05): CORS never pairs "*" with Authorization.
//
// Before 121.26 every response carried Access-Control-Allow-Origin: * and
// Access-Control-Allow-Headers: Content-Type, Authorization, so any web page
// could send a credential a self-hoster had layered on, and there was no way
// to restrict origins. Now: unset CORS_ALLOW_ORIGINS keeps "*" without
// Authorization; setting it echoes only listed origins, with Authorization.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

async function preflight(env, origin) {
  const saved = process.env.CORS_ALLOW_ORIGINS;
  if (env === undefined) delete process.env.CORS_ALLOW_ORIGINS;
  else process.env.CORS_ALLOW_ORIGINS = env;
  try {
    const { createApp } = await import("../server.js");
    const app = createApp();
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    try {
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/health`, {
        method: "OPTIONS",
        headers: origin ? { Origin: origin, "Access-Control-Request-Headers": "authorization" } : {},
      });
      return {
        status: res.status,
        acao: res.headers.get("access-control-allow-origin"),
        acah: res.headers.get("access-control-allow-headers") || "",
      };
    } finally { srv.close(); }
  } finally {
    if (saved === undefined) delete process.env.CORS_ALLOW_ORIGINS;
    else process.env.CORS_ALLOW_ORIGINS = saved;
  }
}

describe("CORS (TOK-05)", () => {
  it("default: any origin, but Authorization is not an allowed header", async () => {
    const r = await preflight(undefined, "https://evil.example");
    assert.equal(r.acao, "*");
    assert.ok(!/authorization/i.test(r.acah), `allow-headers: ${r.acah}`);
  });

  it("allow-list: a listed origin is echoed and may send Authorization", async () => {
    const r = await preflight("https://ok.example, https://also.example", "https://ok.example");
    assert.equal(r.acao, "https://ok.example");
    assert.match(r.acah, /authorization/i);
  });

  it("allow-list: an unlisted origin gets no CORS grant", async () => {
    const r = await preflight("https://ok.example", "https://evil.example");
    assert.equal(r.acao, null);
    assert.ok(!/authorization/i.test(r.acah));
  });
});
