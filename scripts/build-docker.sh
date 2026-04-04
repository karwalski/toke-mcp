#!/usr/bin/env bash
set -euo pipefail

# build-docker.sh — Build and optionally push the toke-mcp self-hosted Docker image.
#
# Usage:
#   ./scripts/build-docker.sh                          # build for current platform
#   ./scripts/build-docker.sh --push                   # build + push to ghcr.io
#   ./scripts/build-docker.sh --platform linux/amd64   # single platform
#   ./scripts/build-docker.sh --tag my-tag             # custom tag

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
PUSH=false
PLATFORM="linux/amd64,linux/arm64"
CUSTOM_TAG=""
REGISTRY="ghcr.io/karwalski/toke-mcp"

# Read version from package.json
VERSION=$(node -e "console.log(require('$PROJECT_ROOT/package.json').version)")

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --tag TAG          Custom image tag (default: version from package.json)"
    echo "  --push             Push image to $REGISTRY"
    echo "  --platform PLAT    Target platforms (default: $PLATFORM)"
    echo "  -h, --help         Show this help"
    echo ""
    echo "Tags applied: $REGISTRY:latest and $REGISTRY:\$VERSION"
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tag)
            CUSTOM_TAG="$2"
            shift 2
            ;;
        --push)
            PUSH=true
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage
            ;;
    esac
done

# Determine tags
if [[ -n "$CUSTOM_TAG" ]]; then
    TAGS="-t $REGISTRY:$CUSTOM_TAG"
else
    TAGS="-t $REGISTRY:latest -t $REGISTRY:$VERSION"
fi

# Verify tkc binary exists in build context
if [[ ! -f "$PROJECT_ROOT/tkc" ]]; then
    echo "Error: no tkc binary at $PROJECT_ROOT/tkc" >&2
    echo "Copy the Linux tkc binary into the project root before building:" >&2
    echo "  cp ~/tk/tkc/tkc $PROJECT_ROOT/tkc" >&2
    exit 1
fi

echo "Building toke-mcp Docker image"
echo "  Version:   $VERSION"
echo "  Platform:  $PLATFORM"
echo "  Tags:      $TAGS"
echo "  Push:      $PUSH"
echo ""

# Build arguments
BUILD_ARGS=(
    "buildx" "build"
    "--file" "$PROJECT_ROOT/Dockerfile.selfhosted"
    "--platform" "$PLATFORM"
)

# Split TAGS into array elements
eval "BUILD_ARGS+=($TAGS)"

if [[ "$PUSH" == "true" ]]; then
    BUILD_ARGS+=("--push")
else
    BUILD_ARGS+=("--load")
fi

BUILD_ARGS+=("$PROJECT_ROOT")

docker "${BUILD_ARGS[@]}"

echo ""
echo "Build complete."
if [[ "$PUSH" == "true" ]]; then
    echo "Pushed to $REGISTRY:latest and $REGISTRY:$VERSION"
else
    echo "Image built locally. Use --push to publish to $REGISTRY."
fi
