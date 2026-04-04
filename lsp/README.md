# toke-lsp

Language Server Protocol implementation for the Toke programming language. Wraps the `tkc` compiler to provide real-time diagnostics, hover information, and document symbols.

## Features

- **Diagnostics** -- runs `tkc --check --diag-json` on save/change (debounced 300ms), maps error codes to LSP severities
- **Hover** -- shows type information from `tkc --emit-interface` for identifiers, and brief descriptions for Toke keywords
- **Document Symbols** -- lists top-level functions, types, and constants from the interface file

## Prerequisites

- Node.js >= 20
- `tkc` compiler on PATH (or configure a custom path)

## Install

```sh
cd lsp/
npm install
```

## Configuration

The server accepts two configuration keys:

| Key                | Default | Description                     |
|--------------------|---------|---------------------------------|
| `toke.tkc.path`    | `tkc`   | Path to the tkc binary          |
| `toke.tkc.stdlib`  | (none)  | Override stdlib directory        |

These can be set via `initializationOptions` or `workspace/didChangeConfiguration`.

## Editor Setup

### VS Code

Use with the toke-vscode extension (story 10.12.21), or configure manually in `settings.json`:

```json
{
  "toke.tkc.path": "/usr/local/bin/tkc",
  "toke.tkc.stdlib": "/usr/local/lib/toke/stdlib"
}
```

For a generic LSP client extension, point the server command to:

```
node /path/to/toke-cloud/lsp/server.js --stdio
```

### Neovim

Using `nvim-lspconfig`, add to your `init.lua`:

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.toke then
  configs.toke = {
    default_config = {
      cmd = { 'node', '/path/to/toke-cloud/lsp/server.js', '--stdio' },
      filetypes = { 'toke' },
      root_dir = lspconfig.util.find_git_ancestor,
      settings = {
        toke = {
          tkc = {
            path = 'tkc',
            stdlib = '',
          },
        },
      },
    },
  }
end

lspconfig.toke.setup({})
```

Add file type detection in `filetype.lua`:

```lua
vim.filetype.add({
  extension = {
    tk = 'toke',
  },
})
```

### JetBrains (IntelliJ / CLion / WebStorm)

1. Install the **LSP Support** plugin from the JetBrains Marketplace.
2. Go to **Settings > Languages & Frameworks > Language Server Protocol > Server Definitions**.
3. Add a new server:
   - **Executable:** `node`
   - **Arguments:** `/path/to/toke-cloud/lsp/server.js --stdio`
   - **File patterns:** `*.tk`
4. Apply and restart.

## Protocol

The server communicates over stdio using the LSP JSON-RPC protocol. It supports:

- `textDocument/publishDiagnostics` (server-initiated)
- `textDocument/hover`
- `textDocument/documentSymbol`
- `workspace/didChangeConfiguration`
