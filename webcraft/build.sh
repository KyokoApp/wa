#!/usr/bin/env bash
# Build rustcraft.wasm from the Rust engine (webcraft/engine).
#
# Strategy:
#   1. Use rustc from PATH (rustup users: `rustup target add wasm32-unknown-unknown`).
#   2. Use a previously bootstrapped toolchain at ~/toolchain.
#   3. Bootstrap a full Rust toolchain from npm (@toolchain-bin) — works in
#      air-gapped environments that only allow the npm registry.
set -euo pipefail
cd "$(dirname "$0")"

TARGET=wasm32-unknown-unknown
OUT=web/rustcraft.wasm
FLAGS=(--target $TARGET --crate-type cdylib --edition 2021
       -C opt-level=3 -C lto=fat -C codegen-units=1 -C panic=abort
       -C strip=symbols -C link-arg=--allow-undefined)

find_rustc() {
  if command -v rustc >/dev/null 2>&1; then echo "rustc"; return; fi
  if [ -x "$HOME/toolchain/bin/rustc" ]; then echo "$HOME/toolchain/bin/rustc"; return; fi
  echo ""
}

RUSTC=$(find_rustc)

if [ -z "$RUSTC" ]; then
  echo "==> Rust toolchain tidak ditemukan, bootstrap dari npm (@toolchain-bin)…"
  TMP=$(mktemp -d)
  TC="$HOME/toolchain"
  npm pack @toolchain-bin/rustc-1.99.0-x86_64-unknown-linux-gnu \
           @toolchain-bin/rust-std-1.99.0-x86_64-unknown-linux-gnu \
           @toolchain-bin/rust-std-1.99.0-wasm32-unknown-unknown --pack-destination "$TMP" >/dev/null
  mkdir -p "$TMP/x"
  for f in "$TMP"/*.tgz; do tar xzf "$f" -C "$TMP/x"; done
  mkdir -p "$TC"
  cp -a "$TMP/x/package/rustc/." "$TC/"
  cp -a "$TMP/x/package/rust-std-x86_64-unknown-linux-gnu/lib/rustlib/x86_64-unknown-linux-gnu/." \
        "$TC/lib/rustlib/x86_64-unknown-linux-gnu/"
  mkdir -p "$TC/lib/rustlib/wasm32-unknown-unknown"
  cp -a "$TMP/x/package/rust-std-wasm32-unknown-unknown/lib/rustlib/wasm32-unknown-unknown/." \
        "$TC/lib/rustlib/wasm32-unknown-unknown/"
  chmod -R u+w "$TC"
  chmod +x "$TC"/bin/* "$TC"/lib/rustlib/x86_64-unknown-linux-gnu/bin/* \
           "$TC"/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/* 2>/dev/null || true
  rm -rf "$TMP"
  RUSTC="$TC/bin/rustc"
fi

echo "==> $($RUSTC --version)"
echo "==> compiling engine/src/lib.rs -> $OUT"
"$RUSTC" "${FLAGS[@]}" engine/src/lib.rs -o "$OUT"
ls -la "$OUT"
echo "==> selesai. Jalankan: node server.mjs  lalu buka http://localhost:8080"
