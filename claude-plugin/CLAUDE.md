# Toke Language — Claude Code Project Instructions

## Language Skill

Read `skills/toke-language.md` for the complete Toke language reference before generating or editing any `.tk` file. Key points:

- Toke uses **semicolons everywhere** (arguments, fields, array elements) — never commas
- The compiler currently accepts **Phase 1 syntax** (uppercase `M`, `F`, `T`, `I`)
- Short return is `<expr`, not `return expr`
- Mutable bindings use `let x=mut.0;`, not `let mut x=0;`
- Equality is single `=` inside expressions: `if(x=5)` — there is no `==`

## MCP Tools

This project is configured to connect to the hosted Toke MCP service. The following tools are available:

- **toke_check** — validate Toke source code and receive structured JSON diagnostics (error code, line, column, message, fix suggestion)
- **toke_compile** — compile Toke source to LLVM IR or receive diagnostics on failure

## Check-Repair Loop

When writing or modifying Toke code, always follow this pattern:

1. **Generate** the `.tk` source using the language skill for reference
2. **Check** by calling the `toke_check` MCP tool with the source content
3. **Read diagnostics** — parse the JSON response for any errors
4. **Fix** each diagnostic using the error code, line number, and fix suggestion
5. **Re-check** by calling `toke_check` again with the corrected source
6. **Repeat** steps 3-5 until diagnostics are clean (zero errors)

Never present Toke code to the user as "done" without passing it through `toke_check` first.

## Agents

- **toke-repair** (`agents/toke-repair.md`) — generate Toke from natural language, validate via MCP, and iteratively fix errors until clean (up to 5 iterations)

## Slash Commands

- `/toke:check` — validate the current `.tk` file against the compiler
- `/toke:new` — scaffold a new Toke project with a module, main function, and Makefile
- `/toke:repair` — generate Toke source from a natural-language task description using the toke-repair agent
