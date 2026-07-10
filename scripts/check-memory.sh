#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/src-tauri"

cargo test --release core::storage::tests::
cargo test --release core::logging::tests::
cargo test --release core::auth_store::tests::
cargo test --release engine::process::tests::

if command -v leaks >/dev/null 2>&1; then
  leaks --atExit -- cargo test --release engine::process::tests::fake_runner_returns_process_output_without_spawning
fi
