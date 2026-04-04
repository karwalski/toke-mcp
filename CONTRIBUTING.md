# Contributing to toke-cloud

Thank you for your interest in contributing to the Toke MCP server. This guide covers local setup, testing, code style, and how to add new tools.

## Local development setup

1. **Prerequisites:** Node.js 20+, a `tkc` binary on your PATH (or set `TKC_PATH`).

2. **Clone and install:**
   ```bash
   git clone https://github.com/tokelang/toke-cloud.git
   cd toke-cloud
   npm install
   ```

3. **Start the server:**
   ```bash
   node server.js
   ```

4. **Verify it works:**
   ```bash
   curl http://localhost:3000/health
   ```

   You should see `{"status":"ok","version":"0.1.0","tkc":true}` (or `tkc: false` if the binary is not installed).

## Running tests

```bash
# Run all tests
npm test

# Run a specific test file
node --test test/check_test.js

# Run sandbox security tests (requires Docker)
cd sandbox && bash test_security.sh
```

Tests use Node.js built-in test runner (`node:test`). No additional test framework is needed.

## Code style

- **ESM modules** — all source uses `import`/`export`, not `require()` (except for CJS library shims).
- **JSDoc comments** — document all exported functions with `@param` and `@returns`.
- **No semicolons** are enforced; the codebase currently uses semicolons, so be consistent with existing files.
- **Error handling** — always return structured error objects rather than throwing. Tools should never crash the server.
- **No external formatting tools** are required, but keep indentation at 2 spaces.

## Pull request process

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** with tests.

3. **Run the test suite** and ensure everything passes:
   ```bash
   npm test
   ```

4. **Commit** with a clear message describing what and why.

5. **Open a pull request** against `main`. Fill in the PR template.

6. PRs are **squash merged** to keep a clean history.

## Adding a new MCP tool

Follow these steps to add a new tool to the server.

### 1. Create the tool module

Create `tools/my_tool.js`:

```js
/**
 * My new tool — does something useful.
 * @param {string} input - The input parameter.
 * @returns {Promise<{result: string}>}
 */
export async function myTool(input) {
  // Implementation here
  return { result: "..." };
}
```

### 2. Register the tool in server.js

Import the tool and register it inside `createMcpServer()`:

```js
import { myTool } from "./tools/my_tool.js";

// Inside createMcpServer():
server.tool(
  "toke_my_tool",
  "Description of what the tool does.",
  { input: z.string().describe("What this input is") },
  async ({ input }) => {
    const result = await myTool(input);
    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
    };
  }
);
```

### 3. Add tests

Create `test/my_tool_test.js` using the `node:test` module:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { myTool } from "../tools/my_tool.js";

describe("myTool", () => {
  it("returns a result for valid input", async () => {
    const result = await myTool("test input");
    assert.ok(result.result);
  });
});
```

### 4. Document the tool

Add the tool to the tools table and API reference section in `README.md`.

### 5. Open a PR

Submit your pull request with the new tool, tests, and documentation.

## Security

If you discover a security vulnerability, **do not** open a public issue. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

For general security questions about the sandbox or authentication design, feel free to open a discussion or issue.
