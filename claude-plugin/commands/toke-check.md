# /toke:check — Validate Toke Source

Check the current `.tk` file for compiler errors using the hosted MCP service.

## Steps

1. Identify the `.tk` file the user is working on. If multiple `.tk` files exist, ask which one to check. If only one exists, use it.

2. Read the full contents of the `.tk` file.

3. Call the `toke_check` MCP tool with the file contents as the `source` parameter.

4. Parse the JSON response. If there are no diagnostics, report success:
   - "No errors found. The file compiles cleanly."

5. If there are diagnostics, display them in a clear format:
   - For each diagnostic, show: error code, line number, message, and fix suggestion
   - Ask the user if they want you to apply the suggested fixes automatically

6. If the user wants fixes applied, edit the file to resolve each diagnostic, then re-run `toke_check` to confirm the fixes are correct. Repeat until clean.
