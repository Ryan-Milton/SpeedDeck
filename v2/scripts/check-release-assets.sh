#!/usr/bin/env bash
set -euo pipefail

# Validate reproducible-release inputs before spending time on a bundle build.
# Map packs and the OSRM sidecar are intentionally not committed to this repo;
# npm's and Cargo's lockfiles are committed and must resolve without changes.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
V2_DIR="$(dirname "$SCRIPT_DIR")"
MANIFEST="$V2_DIR/src-tauri/resources/map/regions.json"
MAP_DIR="$(dirname "$MANIFEST")"
TAURI_CONFIG="$V2_DIR/src-tauri/tauri.conf.json"
PACKAGE_LOCK="$V2_DIR/package-lock.json"
CARGO_MANIFEST="$V2_DIR/src-tauri/Cargo.toml"
CARGO_LOCK="$V2_DIR/src-tauri/Cargo.lock"
TARGET_TRIPLE="${1:-${SPEEDDECK_TARGET_TRIPLE:-}}"

if [[ -z "$TARGET_TRIPLE" ]]; then
  command -v rustc >/dev/null 2>&1 || {
    echo "Error: rustc is required to determine the release target" >&2
    exit 1
  }
  TARGET_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
fi

fail() {
  echo "Error: $*" >&2
  exit 1
}

[[ -f "$MANIFEST" ]] || fail "required map manifest is missing: $MANIFEST"
[[ -f "$TAURI_CONFIG" ]] || fail "required Tauri config is missing: $TAURI_CONFIG"
[[ -f "$PACKAGE_LOCK" ]] || fail "required npm lockfile is missing: $PACKAGE_LOCK"
[[ -f "$CARGO_LOCK" ]] || fail "required Cargo lockfile is missing: $CARGO_LOCK"
command -v node >/dev/null 2>&1 || fail "Node.js is required for release preflight"
command -v cargo >/dev/null 2>&1 || fail "Cargo is required for release preflight"
[[ "$TARGET_TRIPLE" == x86_64-unknown-linux-gnu ]] \
  || fail "AppImage releases support only x86_64-unknown-linux-gnu, got: $TARGET_TRIPLE"
[[ "$(node -p 'process.versions.node')" == 22.14.* ]] \
  || fail "Node.js 22.14.x is required; see package.json"
[[ "$(npm --version)" == 10.9.* ]] \
  || fail "npm 10.9.x is required; see package.json"

# This checks that Cargo will neither update nor recreate the committed lockfile.
cargo metadata --locked --manifest-path "$CARGO_MANIFEST" --no-deps --format-version 1 >/dev/null \
  || fail "Cargo.lock is not usable with Cargo.toml; run cargo update deliberately and commit the result"
npm ci --ignore-scripts --dry-run >/dev/null \
  || fail "package-lock.json is not usable with package.json; run npm install deliberately and commit the result"

# Enforce lockfile tracking when this is a Git checkout. Docker intentionally
# omits .git from its context, so source archives can still be preflighted.
if command -v git >/dev/null 2>&1 && git -C "$V2_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$V2_DIR" ls-files --error-unmatch package-lock.json src-tauri/Cargo.lock >/dev/null \
    || fail "package-lock.json and src-tauri/Cargo.lock must remain tracked"
fi

node - "$MANIFEST" "$MAP_DIR" "$TAURI_CONFIG" <<'NODE'
const fs = require("fs");
const path = require("path");
const [manifestPath, mapDir, tauriConfigPath] = process.argv.slice(2);
let manifest, tauriConfig;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
} catch (error) {
  console.error(`Error: cannot parse release config: ${error.message}`);
  process.exit(1);
}
const resources = tauriConfig?.bundle?.resources;
if (resources?.["resources/map"] !== "map") {
  console.error("Error: tauri.conf.json must map resources/map to bundled resource directory map");
  process.exit(1);
}
if (!Array.isArray(tauriConfig?.bundle?.externalBin) || !tauriConfig.bundle.externalBin.includes("binaries/osrm-routed")) {
  console.error("Error: tauri.conf.json must bundle the binaries/osrm-routed sidecar");
  process.exit(1);
}
if (!Array.isArray(manifest.regions) || manifest.regions.length === 0) {
  console.error(`Error: map manifest ${manifestPath} must contain at least one region`);
  process.exit(1);
}
for (const region of manifest.regions) {
  if (typeof region.file !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.pmtiles$/.test(region.file)) {
    console.error(`Error: invalid PMTiles filename for region ${JSON.stringify(region.id)}`);
    process.exit(1);
  }
  const asset = path.join(mapDir, region.file);
  if (!fs.existsSync(asset) || fs.statSync(asset).size === 0) {
    console.error(`Error: required PMTiles asset for region ${region.id} is missing or empty: ${asset}`);
    process.exit(1);
  }
  const header = Buffer.alloc(8);
  const fd = fs.openSync(asset, "r");
  const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
  fs.closeSync(fd);
  if (fs.statSync(asset).size < 127 || bytesRead !== 8 || header.subarray(0, 7).toString("ascii") !== "PMTiles" || header[7] !== 3) {
    console.error(`Error: PMTiles asset for region ${region.id} does not have a valid PMTiles v3 header: ${asset}`);
    process.exit(1);
  }
}
NODE

SIDECAR="$V2_DIR/src-tauri/binaries/osrm-routed-$TARGET_TRIPLE"
[[ -x "$SIDECAR" ]] || fail "required navigation sidecar is missing or not executable: $SIDECAR"

checked_sidecar=false
if command -v file >/dev/null 2>&1; then
  sidecar_type="$(file -Lb "$SIDECAR")"
  [[ "$sidecar_type" == *"ELF 64-bit"* && "$sidecar_type" == *"x86-64"* ]] \
    || fail "navigation sidecar must be a Linux x86_64 ELF binary; file reports: $sidecar_type"
  checked_sidecar=true
fi
if command -v readelf >/dev/null 2>&1; then
  elf_header="$(readelf -h "$SIDECAR" 2>/dev/null)" \
    || fail "navigation sidecar is not a readable ELF binary: $SIDECAR"
  [[ "$elf_header" == *"Class:"*"ELF64"* \
    && "$elf_header" == *"Data:"*"little endian"* \
    && "$elf_header" == *"Machine:"*"X86-64"* ]] \
    || fail "navigation sidecar ELF header is not Linux x86_64: $SIDECAR"
  checked_sidecar=true
fi
if [[ "$checked_sidecar" == false ]]; then
  echo "Warning: install file or readelf to verify the sidecar ELF architecture" >&2
fi

echo "Release inputs verified for $TARGET_TRIPLE."
