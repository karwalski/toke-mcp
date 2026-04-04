# /toke:repair — Generate Toke from Natural Language

Generate valid Toke source code from a natural-language task description, using the compiler to iteratively check and fix errors.

## Steps

1. If the user provided a task description (e.g., `/toke:repair a function that computes factorial`), use it directly. If no description was provided, ask the user what they want the program to do.

2. Delegate to the `toke-repair` agent with the task description. The agent will:
   - Generate initial Toke source using default syntax (`m=`, `f=`, `t=`, `$` types, `@` arrays)
   - Validate via the `toke_check` MCP tool
   - Iteratively fix any compiler errors (up to 5 rounds)
   - Optionally compile to LLVM IR via `toke_compile`

3. Present the agent's result to the user:
   - If successful: show the final clean source code and iteration count
   - If failed after 5 iterations: show the code, remaining errors, and suggest manual fixes
