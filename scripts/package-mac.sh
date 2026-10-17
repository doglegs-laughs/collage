#!/usr/bin/env bash
# Builds release/Collage-mac-arm64.zip: an ad-hoc signed Collage.app (Apple Silicon).
# On Linux, electron-builder can't sign and its zip drops framework symlinks, so sign with
# rcodesign (or codesign on macOS) and zip with symlinks preserved.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
node scripts/fetch-ffmpeg.mjs
npx electron-builder --mac --arm64
app=release/mac-arm64/Collage.app
if [[ "$(uname)" == Darwin ]]; then
  codesign --force --deep --sign - "$app"
else
  rc=.cache/rcodesign
  if [[ ! -x $rc ]]; then
    mkdir -p .cache
    curl -sSL https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F0.29.0/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz | tar xz -C .cache --strip-components=1
  fi
  "$rc" sign "$app/Contents/Resources/ffmpeg/ffmpeg"
  "$rc" sign "$app"
fi
rm -f release/Collage-mac-arm64.zip
(cd release/mac-arm64 && zip -qry ../Collage-mac-arm64.zip Collage.app)
ls -lh release/Collage-mac-arm64.zip
