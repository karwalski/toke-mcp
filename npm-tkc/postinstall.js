#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const PLATFORM_MAP = {
  "darwin-arm64": "@tokelang/tkc-darwin-arm64",
  "darwin-x64": "@tokelang/tkc-darwin-x64",
  "linux-x64": "@tokelang/tkc-linux-x64",
  "linux-arm64": "@tokelang/tkc-linux-arm64",
};

function getPackageName() {
  const platform = os.platform();
  const arch = os.arch();
  const key = `${platform}-${arch}`;
  return PLATFORM_MAP[key] || null;
}

function findBinary(packageName) {
  // Try to resolve the platform package's binary
  const candidates = [
    // Standard node_modules resolution
    path.join(__dirname, "node_modules", packageName, "bin", "tkc"),
    // Hoisted in a monorepo / workspace
    path.join(__dirname, "..", packageName, "bin", "tkc"),
    // npm hoisted
    path.join(__dirname, "..", "..", packageName, "bin", "tkc"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Try require.resolve as a last resort
  try {
    const pkgJson = require.resolve(`${packageName}/package.json`);
    const pkgDir = path.dirname(pkgJson);
    const binPath = path.join(pkgDir, "bin", "tkc");
    if (fs.existsSync(binPath)) {
      return binPath;
    }
  } catch (e) {
    // Package not installed
  }

  return null;
}

function main() {
  const packageName = getPackageName();

  if (!packageName) {
    const platform = os.platform();
    const arch = os.arch();
    console.warn(
      `@tokelang/tkc: No prebuilt binary available for ${platform}-${arch}.`
    );
    console.warn(
      "See https://github.com/karwalski/toke-mcp for build instructions."
    );
    process.exit(0);
  }

  const sourceBinary = findBinary(packageName);

  if (!sourceBinary) {
    // The optional dependency may not have been installed (npm skips optional
    // deps that don't match os/cpu). This is normal on unsupported platforms.
    console.warn(
      `@tokelang/tkc: Platform package ${packageName} not found. ` +
        "The tkc binary may not be available."
    );
    process.exit(0);
  }

  // Copy the binary into our own bin/ directory
  const destBinary = path.join(__dirname, "bin", "tkc");

  try {
    fs.copyFileSync(sourceBinary, destBinary);
    fs.chmodSync(destBinary, 0o755);
  } catch (err) {
    console.warn(`@tokelang/tkc: Failed to install binary: ${err.message}`);
    process.exit(0);
  }
}

main();
