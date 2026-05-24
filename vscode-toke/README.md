# Toke Language Support for VS Code

Syntax highlighting, diagnostics, and code intelligence for the [Toke programming language](https://tokelang.dev).

## Features

- **Syntax highlighting** -- TextMate grammar for `.tk` files covering keywords, types, literals, declarations, and operators
- **Snippets** -- Common patterns: module, function, type, import, loop, if-else, let bindings, main
- **Language server** -- Diagnostics, hover info, and document symbols via `toke-lsp` (requires separate installation)
- **Status bar** -- Shows "Toke" indicator when editing `.tk` files

## Installation

### From source

```
cd vscode-toke
npm install
npm run compile
npx vsce package
code --install-extension toke-language-0.1.0.vsix
```

### Language server

Install `toke-lsp` and ensure it is on your PATH. The extension will connect automatically.

To change the LSP binary path, set `toke.lsp.path` in VS Code settings. To disable the language server, set `toke.lsp.enabled` to `false`.

## Snippets

| Prefix    | Expands to                          |
|-----------|-------------------------------------|
| `mod`     | `m=name;`                          |
| `f`       | `f=name(params):$ret{...}`         |
| `t`       | `t=Name{field:$type}`              |
| `imp`     | `i=alias:path;`                    |
| `loop`    | `lp(init;cond;step){...}`          |
| `ifelse`  | `if(cond){...}el{...}`             |
| `let`     | `let name=value;`                  |
| `letmut`  | `let name=mut.value;`              |
| `main`    | Full main function template         |

## Settings

| Setting          | Default     | Description                          |
|------------------|-------------|--------------------------------------|
| `toke.lsp.path`  | `toke-lsp`  | Path to the toke-lsp binary          |
| `toke.lsp.enabled` | `true`   | Enable the Toke language server      |

## Screenshots

<!-- TODO: Add screenshots before publishing to VS Code Marketplace.
     Required images (place in vscode-toke/images/):
     - toke-icon.png (128x128, extension icon)
     - screenshot-highlighting.png (syntax highlighting demo)
     - screenshot-diagnostics.png (LSP diagnostics demo)
     - screenshot-snippets.png (snippet expansion demo)
-->
