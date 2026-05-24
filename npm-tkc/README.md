# @tokelang/tkc

The toke language checker. Fast, correct, minimal.

## Installation

```sh
npm install -g @tokelang/tkc
```

## Usage

```sh
# Check a file
tkc --check myfile.tk

# Run via npx (no install needed)
npx @tokelang/tkc --check myfile.tk
```

## Supported Platforms

| OS      | Architecture | Package                      |
|---------|-------------|------------------------------|
| macOS   | ARM64       | @tokelang/tkc-darwin-arm64   |
| macOS   | x64         | @tokelang/tkc-darwin-x64     |
| Linux   | x64         | @tokelang/tkc-linux-x64     |
| Linux   | ARM64       | @tokelang/tkc-linux-arm64   |

The correct binary is installed automatically based on your platform via npm's
optional dependency mechanism (the same pattern used by esbuild, turbo, and biome).

## How It Works

The `@tokelang/tkc` package declares platform-specific packages as optional
dependencies. npm only installs the one matching your OS and CPU architecture.
A postinstall script copies the binary into place.

## License

MIT
