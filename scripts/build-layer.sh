#!/usr/bin/env bash
set -euo pipefail

# build-layer.sh — Package the tkc binary into Lambda layer format.
#
# Usage:
#   ./scripts/build-layer.sh            # expects tkc binary at layers/tkc/bin/tkc
#   ./scripts/build-layer.sh --local    # copies from ~/tk/tkc/tkc
#
# The resulting layer directory structure:
#   layers/tkc/bin/tkc
#
# This directory is referenced by the CDK construct as the layer asset path.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LAYER_DIR="$PROJECT_ROOT/layers/tkc"
LAYER_BIN="$LAYER_DIR/bin"
LOCAL_TKC="$HOME/tk/tkc/tkc"

usage() {
    echo "Usage: $0 [--local]"
    echo ""
    echo "Options:"
    echo "  --local    Copy tkc binary from $LOCAL_TKC"
    echo ""
    echo "Without --local, verifies the binary exists at $LAYER_BIN/tkc"
    exit 1
}

mkdir -p "$LAYER_BIN"

if [[ "${1:-}" == "--local" ]]; then
    if [[ ! -f "$LOCAL_TKC" ]]; then
        echo "Error: local tkc binary not found at $LOCAL_TKC" >&2
        exit 1
    fi
    echo "Copying tkc from $LOCAL_TKC ..."
    cp "$LOCAL_TKC" "$LAYER_BIN/tkc"
    chmod +x "$LAYER_BIN/tkc"
    echo "Layer binary placed at $LAYER_BIN/tkc"
elif [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
    usage
elif [[ -n "${1:-}" ]]; then
    echo "Unknown option: $1" >&2
    usage
fi

# Verify binary exists
if [[ ! -f "$LAYER_BIN/tkc" ]]; then
    echo "Error: no tkc binary at $LAYER_BIN/tkc" >&2
    echo "Run with --local to copy from local build, or place the binary manually." >&2
    exit 1
fi

# Print binary info
echo ""
echo "Layer contents:"
ls -lh "$LAYER_BIN/tkc"
file "$LAYER_BIN/tkc" 2>/dev/null || true

# Print version if possible
if "$LAYER_BIN/tkc" --version 2>/dev/null; then
    :
fi

echo ""
echo "Layer ready at: $LAYER_DIR"
echo "CDK asset path: layers/tkc (relative to infra/)"
