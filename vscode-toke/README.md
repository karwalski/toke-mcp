# toke language support for VS Code

Syntax highlighting, diagnostics and code intelligence for the
[toke programming language](https://tokelang.dev).

## About toke

> toke: a compiled language designed for LLM code generation, with a small grammar, one
> canonical form and compiler verification.

toke is a compiled programming language designed for LLM code generation. It has 14
keywords, a 59-character set, a backtrack-free grammar with bounded lookahead, and one
canonical form per construct, chosen by measurement in a 46-pattern catalogue and
reproduced by `tkc --min`. That makes generated code cheap to constrain during decoding,
cheap for a compiler to verify afterwards, and compact to emit. Token efficiency is one
measured property of toke, always reported with its tokenizer and its baseline, not the
whole claim.

- Website: [tokelang.dev](https://tokelang.dev)
- Compiler, specification and standard library:
  [github.com/karwalski/toke](https://github.com/karwalski/toke)
- This extension:
  [github.com/karwalski/toke-mcp](https://github.com/karwalski/toke-mcp) (`vscode-toke/`)

*The one-liner and the paragraph above are reproduced word for word from the canonical
description,
[`docs/about/canonical.md`](https://github.com/karwalski/toke/blob/main/docs/about/canonical.md).
Every number published about toke comes from
[`docs/metrics-baseline.md`](https://github.com/karwalski/toke/blob/main/docs/metrics-baseline.md)
and nowhere else.*

## Features

- **Syntax highlighting** -- TextMate grammar for `.tk` files covering keywords, types, literals, declarations, and operators
- **Snippets** -- Common patterns: module, function, type, import, loop, if-else, let bindings, main
- **Language server** -- Diagnostics, hover info, and document symbols via `toke-lsp` (requires separate installation)
- **Status bar** -- Shows a "toke" indicator when editing `.tk` files

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
