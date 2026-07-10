#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/third_party/ipatool-shuttle"
BIN_DIR="$ROOT_DIR/src-tauri/resources/bin"
DESTINATION="$BIN_DIR/apple-auth-engine"
TEMP_BINARY="$(mktemp "$BIN_DIR/.apple-auth-engine.XXXXXX")"

cleanup() {
  rm -f "$TEMP_BINARY"
}
trap cleanup EXIT INT TERM

command -v go >/dev/null 2>&1 || {
  printf 'build:engine: stable Go toolchain is required\n' >&2
  exit 1
}

cd "$SOURCE_DIR"
go build -trimpath -buildvcs=false -ldflags="-s -w" -o "$TEMP_BINARY" .
chmod 0755 "$TEMP_BINARY"

if nm -u "$TEMP_BINARY" 2>/dev/null | grep -Eq '_SecItem(Add|CopyMatching|Delete|Update)'; then
  printf 'build:engine: direct macOS Keychain symbols are forbidden\n' >&2
  exit 1
fi

mv -f "$TEMP_BINARY" "$DESTINATION"
printf 'build:engine: %s\n' "$(go version)"
