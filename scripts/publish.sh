#!/usr/bin/env bash
set -euo pipefail

# publish.sh -- Prepare and publish @tokelang/mcp-server to npm
#
# Usage: ./scripts/publish.sh

cd "$(dirname "$0")/.."

echo "=== Pre-publish checks ==="

# 1. Verify tests pass (if test script exists)
if npm run test --if-present 2>/dev/null; then
  echo "[OK] Tests passed"
else
  echo "[WARN] No test script defined or tests failed"
fi

# 2. Verify version has been bumped
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "[INFO] Current version: ${CURRENT_VERSION}"

PUBLISHED_VERSION=$(npm view @tokelang/mcp-server version 2>/dev/null || echo "not-published")
echo "[INFO] Published version: ${PUBLISHED_VERSION}"

if [ "${CURRENT_VERSION}" = "${PUBLISHED_VERSION}" ]; then
  echo "[ERROR] Version ${CURRENT_VERSION} is already published. Bump the version first:"
  echo "  npm version patch   # or minor / major"
  exit 1
fi

# 3. Preview package contents
echo ""
echo "=== Package contents (dry run) ==="
npm pack --dry-run
echo ""

# 4. Confirm publication
read -rp "Publish @tokelang/mcp-server@${CURRENT_VERSION} to npm? [y/N] " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# 5. Publish
npm publish

echo ""
echo "[OK] Published @tokelang/mcp-server@${CURRENT_VERSION}"

# 6. Tag the git commit
git tag "v${CURRENT_VERSION}"
echo "[OK] Tagged git commit as v${CURRENT_VERSION}"
echo ""
echo "Don't forget to push the tag:"
echo "  git push origin v${CURRENT_VERSION}"
