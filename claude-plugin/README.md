# Toke Language Plugin for Claude Code

A Claude Code plugin that provides Toke language support via the hosted MCP service at `mcp.tokelang.dev`.

## What It Provides

- **MCP connection** to the hosted Toke compiler service (`toke_check` and `toke_compile` tools)
- **Language skill** with complete Toke syntax reference, type system, idioms, and examples
- **Slash commands:**
  - `/toke:check` — validate the current `.tk` file and display diagnostics
  - `/toke:new` — scaffold a new Toke project with module, main function, and Makefile
- **Check-repair loop** — instructions that teach Claude to generate, validate, and fix Toke code iteratively

## Installation

### Option 1: Add as a project dependency

Clone the repository and add the plugin path to your Claude Code project configuration:

```bash
git clone git@github.com:karwalski/toke-mcp.git
```

Then in your project's `.claude/settings.json`, add the plugin directory as a project path, or copy the contents of `claude-plugin/` into your project's `.claude/` directory:

```bash
cp toke-mcp/claude-plugin/.mcp.json .mcp.json
cp toke-mcp/claude-plugin/CLAUDE.md CLAUDE.md
cp -r toke-mcp/claude-plugin/skills/ skills/
cp -r toke-mcp/claude-plugin/commands/ commands/
```

### Option 2: Work directly from the plugin directory

```bash
cd toke-mcp/claude-plugin
claude
```

Claude Code will pick up the `.mcp.json`, `CLAUDE.md`, skills, and commands automatically.

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- Internet access to reach `mcp.tokelang.dev` (the hosted MCP endpoint)

## File Structure

```
claude-plugin/
  .mcp.json              MCP server configuration (remote SSE endpoint)
  CLAUDE.md              Project instructions for Claude (skill reference, check-repair loop)
  skills/
    toke-language.md     Complete Toke language reference
  commands/
    toke-check.md        /toke:check slash command
    toke-new.md          /toke:new slash command
  README.md              This file
```
