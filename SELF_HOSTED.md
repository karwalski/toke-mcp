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
