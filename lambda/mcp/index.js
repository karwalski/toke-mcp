"use strict";

const checkHandler = require("../check/index");
const compileHandler = require("../compile/index");

/**
 * MCP SSE endpoint adapter.
 *
 * Handles two paths:
 *   GET  /mcp/sse      -> SSE connection (server-sent events with tool list)
 *   POST /mcp/messages  -> JSON-RPC tool call dispatch
 *
 * This is a minimal MCP transport layer that routes tool calls to the
 * underlying check and compile handlers.
 */

const TOOLS = [
  {
    name: "toke_check",
    description: "Validate Toke source code and return structured diagnostics",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Toke source code to check",
        },
      },
      required: ["source"],
    },
  },
  {
    name: "toke_compile",
    description: "Compile Toke source code to LLVM IR",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Toke source code to compile",
        },
      },
      required: ["source"],
    },
  },
];

exports.handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method || event.httpMethod || "GET";
    const path = event.requestContext?.http?.path || event.path || "";

    // GET /mcp/sse — SSE endpoint: return tool list as initialization event
    if (method === "GET" && path.includes("/mcp/sse")) {
      return sseResponse([
        sseEvent("endpoint", JSON.stringify({
          url: "/mcp/messages",
          method: "POST",
        })),
        sseEvent("message", JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "toke-cloud", version: "0.1.0" },
            capabilities: { tools: {} },
          },
        })),
      ]);
    }

    // POST /mcp/messages — JSON-RPC dispatch
    if (method === "POST") {
      const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      return await handleJsonRpc(body);
    }

    return jsonResponse(404, { error: "Not found" });
  } catch (err) {
    console.error("mcp handler error:", err);
    return jsonResponse(500, {
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal error", data: err.message },
      id: null,
    });
  }
};

async function handleJsonRpc(body) {
  const { jsonrpc, method, params, id } = body;

  if (jsonrpc !== "2.0") {
    return jsonResponse(400, {
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid JSON-RPC version" },
      id: id ?? null,
    });
  }

  // initialize — return server capabilities
  if (method === "initialize") {
    return jsonResponse(200, {
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "toke-cloud", version: "0.1.0" },
        capabilities: { tools: {} },
      },
      id,
    });
  }

  // tools/list — enumerate available tools
  if (method === "tools/list") {
    return jsonResponse(200, {
      jsonrpc: "2.0",
      result: { tools: TOOLS },
      id,
    });
  }

  // tools/call — dispatch to handler
  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    if (toolName === "toke_check") {
      const result = await checkHandler.handler({ source: toolArgs.source });
      const resultBody = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
      return jsonResponse(200, {
        jsonrpc: "2.0",
        result: {
          content: [{ type: "text", text: JSON.stringify(resultBody, null, 2) }],
          isError: !resultBody.ok,
        },
        id,
      });
    }

    if (toolName === "toke_compile") {
      const result = await compileHandler.handler({ source: toolArgs.source });
      const resultBody = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
      return jsonResponse(200, {
        jsonrpc: "2.0",
        result: {
          content: [{ type: "text", text: JSON.stringify(resultBody, null, 2) }],
          isError: !resultBody.ok,
        },
        id,
      });
    }

    return jsonResponse(200, {
      jsonrpc: "2.0",
      error: { code: -32601, message: `Unknown tool: ${toolName}` },
      id,
    });
  }

  // Unknown method
  return jsonResponse(200, {
    jsonrpc: "2.0",
    error: { code: -32601, message: `Method not found: ${method}` },
    id,
  });
}

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${data}\n\n`;
}

function sseResponse(events) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
    body: events.join(""),
    isBase64Encoded: false,
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
