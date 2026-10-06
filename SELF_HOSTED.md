# Self-Hosted Toke MCP Server

Run the Toke MCP server locally with Docker. No external dependencies required.

## Quick Start

```bash
docker run -p 3000:3000 ghcr.io/karwalski/toke-mcp
```

Verify it is running:

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"0.1.0","tkc":true}
```

## Configure Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "toke": {
      "type": "sse",
      "url": "http://localhost:3000/mcp/sse"
    }
  }
}
```

Claude Code will now have access to `toke_check`, `toke_compile`, `toke_explain_error`, `toke_spec_lookup`, and `toke_stdlib_ref` tools.

## Configure Codex

Add to your project's `mcp.json`:

```json
{
  "servers": {
    "toke": {
      "type": "sse",
      "url": "http://localhost:3000/mcp/sse"
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `TKC_PATH` | `/usr/local/bin/tkc` | Path to tkc binary inside the container |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `TKC_MAX_CONCURRENT` | CPU count | Most `tkc` processes running at once; further tool calls wait |
| `TKC_MAX_QUEUE` | `32` | Most tool calls waiting for `tkc`; past this a call is refused as busy |
| `TKC_MEMORY_LIMIT_MB` | unset | Run `tkc` under `ulimit -v` with this many MiB. Linux only: where the limit cannot be applied, tool calls fail rather than run without it |
| `TOOL_MAX_SOURCE_CHARS` | `65536` | Longest source or input a tool accepts |

See the [README](README.md#configuration) for the rate and connection limits. They are
[per process](README.md#rate-limits-are-per-process): each instance counts on its own, so N
replicas allow N times each limit.

Every tool call that compiles runs the native `tkc` binary on client-supplied
source, as the server's own user. The variables above bound how many run and
how much they may take; the operating-system boundary is yours to set: run the
server as a dedicated unprivileged user, in a container (the image here does),
with a memory and CPU limit on the container.

Example with custom port:

```bash
docker run -p 8080:8080 -e PORT=8080 ghcr.io/karwalski/toke-mcp
```

## Docker Compose

A `docker-compose.yml` is included for convenience:

```bash
docker compose up
```

This starts the MCP server on port 3000 with health checks enabled.

## Building from Source

1. Clone the repository:

```bash
git clone https://github.com/karwalski/toke-cloud.git
cd toke-cloud
```

2. Copy the tkc binary (Linux static binary) into the project root:

```bash
cp /path/to/tkc ./tkc
```

3. Build the image:

```bash
./scripts/build-docker.sh
```

Or build directly with Docker:

```bash
docker build -f Dockerfile.selfhosted -t toke-mcp .
```

4. Run:

```bash
docker run -p 3000:3000 toke-mcp
```

### Multi-platform Build

Build for both amd64 and arm64:

```bash
./scripts/build-docker.sh --platform linux/amd64,linux/arm64 --push
```

### Publishing

Push to the GitHub Container Registry:

```bash
./scripts/build-docker.sh --push
```

This tags the image as `ghcr.io/karwalski/toke-mcp:latest` and `ghcr.io/karwalski/toke-mcp:{version}` (version read from `package.json`).

## Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/health` | GET | Health check (returns JSON with status, version, tkc availability) |
| `/mcp/sse` | GET | SSE endpoint for MCP connections |
| `/mcp/messages` | POST | JSON-RPC message endpoint for MCP |

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `toke_check` | Check Toke source code for errors, returns JSON diagnostics |
| `toke_compile` | Compile Toke source to LLVM IR |
| `toke_explain_error` | Look up error code, get explanation and fix suggestions |
| `toke_spec_lookup` | Search the Toke language specification |
| `toke_stdlib_ref` | Look up standard library module or function reference |
