import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tokeCheck } from "./tools/check.js";
import { tokeCompile } from "./tools/compile.js";
import { tokeExplainError } from "./tools/explain.js";
import { tokeSpecLookup } from "./tools/spec.js";
import { tokeStdlibRef } from "./tools/stdlib.js";
import { tokeGenerate } from "./tools/generate.js";
import { tokeBench } from "./tools/bench.js";
import { tokeCompanion } from "./tools/companion.js";
import { tokeCompress, tokeDecompress } from "./tools/compress.js";
import { tokeAnalyse } from "./tools/analyse.js";
import { tokeRender } from "./tools/render.js";
import { tokeFormat } from "./tools/format.js";
import { tokeMigrate } from "./tools/migrate.js";
import { tokeFeedback } from "./tools/feedback.js";

const require = createRequire(import.meta.url);
const { checkToolRateLimit, checkConnectionLimit } = require("./lib/rate-limit-middleware.cjs");
const { registerConnection, unregisterConnection } = require("./lib/connection-registry.cjs");

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Read version from package.json at startup
let PKG_VERSION = "0.1.0";
try {
  const pkg = JSON.parse(await readFile(join(__dirname, "package.json"), "utf-8"));
  PKG_VERSION = pkg.version || PKG_VERSION;
} catch {
  // Fall back to hardcoded version
}

// ---------------------------------------------------------------------------
// MCP Server factory
// ---------------------------------------------------------------------------

/**
 * Create a configured MCP server with all 15 toke tools registered.
 *
 * @param {object} [options]
 * @param {string} [options.name]    - Server name (default: "toke-mcp")
 * @param {string} [options.version] - Server version
 * @returns {McpServer}
 */
export function createMcpServer(options = {}) {
  const server = new McpServer({
    name: options.name || "toke-mcp",
    version: options.version || PKG_VERSION,
  });

  server.tool(
    "toke_check",
    "Check Toke source code for errors. Returns JSON diagnostics.",
    { source: z.string().describe("Toke source code to check") },
    async ({ source }) => ({
      content: [{ type: "text", text: JSON.stringify(await tokeCheck(source), null, 2) }],
    })
  );

  server.tool(
    "toke_compile",
    "Compile Toke source code to LLVM IR. Returns IR on success or diagnostics on error.",
    { source: z.string().describe("Toke source code to compile") },
    async ({ source }) => ({
      content: [{ type: "text", text: JSON.stringify(await tokeCompile(source), null, 2) }],
    })
  );

  server.tool(
    "toke_explain_error",
    "Look up a toke error code and return a human-readable explanation with fix suggestions.",
    { error_code: z.string().describe("Toke error code, e.g. 'E1001' or 'W1010'") },
    async ({ error_code }) => ({
      content: [{ type: "text", text: JSON.stringify(tokeExplainError(error_code), null, 2) }],
    })
  );

  server.tool(
    "toke_spec_lookup",
    "Search the toke language specification by keyword. Returns relevant spec sections.",
    { query: z.string().describe("Search query, e.g. 'arrays', 'if statement', 'type sigils'") },
    async ({ query }) => ({
      content: [{ type: "text", text: JSON.stringify(tokeSpecLookup(query), null, 2) }],
    })
  );

  server.tool(
    "toke_stdlib_ref",
    "Look up toke standard library module overview or specific function signature and description.",
    {
      module: z.string().describe("Module name, e.g. 'str', 'db', 'crypto', 'json'"),
      function: z.string().optional().describe("Optional function name, e.g. 'len', 'sha256'"),
    },
    async ({ module, function: fn }) => ({
      content: [{ type: "text", text: JSON.stringify(tokeStdlibRef(module, fn), null, 2) }],
    })
  );

  server.tool(
    "toke_generate",
    "Generate Toke source code from a natural-language description using AI.",
    {
      description: z.string().describe("What the generated code should do"),
      difficulty: z.string().optional().describe("Difficulty hint: 'easy', 'medium', or 'hard'"),
      max_tokens: z.number().optional().describe("Maximum tokens for generation (default 1024)"),
    },
    async ({ description, difficulty, max_tokens }) => ({
      content: [{ type: "text", text: JSON.stringify(await tokeGenerate({ description, difficulty, max_tokens }), null, 2) }],
    })
  );

  server.tool(
    "toke_bench",
    "Benchmark Toke source code against a known task. Compares token count vs Python baseline.",
    {
      source: z.string().describe("Toke source code to benchmark"),
      task_id: z.string().describe("Benchmark task ID, e.g. 'hello-world', 'fizzbuzz', 'fibonacci'"),
    },
    async ({ source, task_id }) => ({
      content: [{ type: "text", text: JSON.stringify(await tokeBench({ source, task_id }), null, 2) }],
    })
  );

  server.tool(
    "toke_companion",
    "Generate, verify, or diff a toke companion file (.tkc.md) skeleton from source code.",
    {
      source: z.string().describe("Toke source code"),
      mode: z.enum(["generate", "verify", "diff"]).optional().describe("Mode: 'generate' (default), 'verify', or 'diff'"),
      companion: z.string().optional().describe("Existing companion file content (required for verify/diff modes)"),
    },
    async ({ source, mode, companion }) => ({
      content: [{ type: "text", text: JSON.stringify(await tokeCompanion(source, mode, companion), null, 2) }],
    })
  );

  server.tool(
    "toke_format",
    "Auto-format toke source code. Tries tkc --fmt first, falls back to a JS-based formatter that normalises indentation, spacing, semicolons, and blank lines.",
    { source: z.string().describe("Toke source code to format") },
    async ({ source }) => ({
      content: [{ type: "text", text: JSON.stringify(await tokeFormat(source), null, 2) }],
    })
  );

  server.tool(
    "toke_migrate",
    "Migrate legacy 80-char syntax toke code to the 56-char default syntax using tkc --migrate.",
    { source: z.string().describe("Legacy 80-char syntax toke source code to migrate") },
    async ({ source }) => ({
      content: [{ type: "text", text: JSON.stringify(await tokeMigrate(source), null, 2) }],
    })
  );

  // STABLE API v1 - do not change schemas below without version bump
  server.tool(
    "toke_compress",
    "Compress text using toke compression (tkc --compress). Returns compressed output with token reduction stats.",
    {
      input: z.string().describe("Text to compress"),
      preserve_atoms: z
        .array(z.string())
        .optional()
        .describe(
          "Regex patterns for tokens to preserve unchanged (e.g. '$[A-Z][A-Z0-9_]+[0-9]+')"
        ),
    },
    async ({ input, preserve_atoms }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await tokeCompress(input, preserve_atoms ?? []),
            null,
            2
          ),
        },
      ],
    })
  );

  server.tool(
    "toke_decompress",
    "Decompress toke-compressed text (tkc --decompress). Returns the original text.",
    {
      input: z.string().describe("Compressed text to decompress"),
    },
    async ({ input }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await tokeDecompress(input), null, 2),
        },
      ],
    })
  );

  server.tool(
    "toke_analyse",
    "Pre-flight token budget estimation. Analyses text and reports raw and estimated compressed token counts without modifying the input.",
    {
      input: z.string().describe("Text to analyse"),
      tokenizer: z
        .enum(["cl100k_base", "o200k_base", "toke-bpe"])
        .optional()
        .describe("Tokenizer to use for counting (default: cl100k_base)"),
    },
    async ({ input, tokenizer }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await tokeAnalyse(input, tokenizer ?? "cl100k_base"),
            null,
            2
          ),
        },
      ],
    })
  );

  server.tool(
    "toke_render",
    "Render a parameterised template by substituting {{varname}} slots. Placeholder atoms ($PERSON_1 etc.) are passed through unchanged. Pure JS — does not call tkc.",
    {
      template: z
        .string()
        .describe("Template string with {{varname}} slots"),
      vars: z
        .record(z.string())
        .optional()
        .describe("Variable substitutions mapping slot names to values"),
    },
    async ({ template, vars }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(tokeRender(template, vars ?? {}), null, 2),
        },
      ],
    })
  );

  server.tool(
    "toke_feedback",
    "Submit feedback on generated toke code — whether it compiled, ran correctly, and optional comments.",
    {
      source: z.string().describe("The toke source code being reviewed"),
      prompt: z.string().describe("The original prompt or description used to generate the code"),
      compiles: z.boolean().describe("Whether the code compiles successfully"),
      runs: z.boolean().optional().describe("Whether the code runs successfully"),
      correct: z.boolean().optional().describe("Whether the code produces correct results"),
      comment: z.string().optional().describe("Optional freeform comment about the generated code"),
    },
    async ({ source, prompt, compiles, runs, correct, comment }) => ({
      content: [{ type: "text", text: JSON.stringify(await tokeFeedback({ source, prompt, compiles, runs, correct, comment }), null, 2) }],
    })
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP + SSE transport
// ---------------------------------------------------------------------------

/**
 * Create an Express app with MCP SSE transport.
 *
 * @param {object} [options]
 * @param {Function} [options.onConnect]      - async (req) => { allowed, statusCode?, body? }
 * @param {Function} [options.onToolCall]     - async (req, toolName, clientIp) => { allowed, headers, statusCode?, body? }
 * @param {Function} [options.onToolComplete] - (toolName, clientIp, latencyMs, success) => void
 * @returns {express.Application}
 */
export function createApp(options = {}) {
  const app = express();
  const TKC_PATH = process.env.TKC_PATH || "tkc";

  // CORS
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Health check
  app.get("/health", async (_req, res) => {
    let tkcAvailable = false;
    try {
      await execFileAsync(TKC_PATH, ["--version"], { timeout: 5_000 });
      tkcAvailable = true;
    } catch { /* tkc not found */ }
    res.json({ status: "ok", version: PKG_VERSION, tkc: tkcAvailable });
  });

  const transports = {};

  // SSE endpoint
  app.get("/mcp/sse", async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";

    // Optional connection check (auth, connection limits, etc.)
    if (options.onConnect) {
      const check = await options.onConnect(req);
      if (check && !check.allowed) {
        return res.status(check.statusCode || 429).json(
          typeof check.body === "string" ? JSON.parse(check.body) : check.body
        );
      }
    } else {
      // Default: use built-in connection limit
      const connCheck = await checkConnectionLimit({ clientIp });
      if (!connCheck.allowed) {
        return res.status(connCheck.statusCode).json(JSON.parse(connCheck.body));
      }
    }

    const server = createMcpServer();
    const transport = new SSEServerTransport("/mcp/messages", res);
    const sessionId = transport.sessionId;

    transports[sessionId] = { transport, clientIp };
    registerConnection(sessionId, { ip: clientIp });

    res.on("close", () => {
      delete transports[sessionId];
      unregisterConnection(sessionId);
    });

    await server.connect(transport);
  });

  // Message endpoint
  app.post("/mcp/messages", express.json(), async (req, res) => {
    const sessionId = req.query.sessionId;
    const session = transports[sessionId];

    if (!session) {
      return res.status(400).json({ error: "Unknown session" });
    }

    const body = req.body;
    const clientIp = session.clientIp;

    // Rate limit tool calls
    if (body && body.method === "tools/call" && body.params?.name) {
      const toolName = body.params.name;

      if (options.onToolCall) {
        const rlResult = await options.onToolCall(req, toolName, clientIp);
        if (rlResult.headers) {
          for (const [key, val] of Object.entries(rlResult.headers)) {
            res.setHeader(key, val);
          }
        }
        if (!rlResult.allowed) {
          return res.status(rlResult.statusCode || 429).json(
            typeof rlResult.body === "string" ? JSON.parse(rlResult.body) : rlResult.body
          );
        }
      } else {
        // Default: use built-in rate limiter
        const rlResult = await checkToolRateLimit({ tool: toolName, clientIp });
        for (const [key, val] of Object.entries(rlResult.headers)) {
          res.setHeader(key, val);
        }
        if (!rlResult.allowed) {
          return res.status(rlResult.statusCode).json(JSON.parse(rlResult.body));
        }
      }

      // Optional usage tracking
      if (options.onToolComplete) {
        const start = Date.now();
        const origEnd = res.end.bind(res);
        res.end = function (...args) {
          options.onToolComplete(toolName, clientIp, Date.now() - start, res.statusCode < 400);
          return origEnd(...args);
        };
      }
    }

    await session.transport.handlePostMessage(req, res);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

// Only start the server if this file is run directly (not imported)
const isMain = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/.*\//, ""));
if (isMain) {
  const PORT = parseInt(process.env.PORT || "3000", 10);
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`toke-mcp server listening on http://localhost:${PORT}`);
    console.log(`  SSE endpoint:    http://localhost:${PORT}/mcp/sse`);
    console.log(`  Health check:    http://localhost:${PORT}/health`);
    console.log(`  tkc binary:      ${process.env.TKC_PATH || "tkc (on PATH)"}`);
  });
}
