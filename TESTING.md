# Testing

Run the production gate from the repository root. No step requires an iPhone
unless it is listed under Manual E2E.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm i18n:check
pnpm build
pnpm knip
pnpm audit --audit-level=low
cargo install cargo-audit@0.22.2 --locked
cargo install cargo-machete@0.9.2 --locked
cd src-tauri
cargo fmt --check
cargo test --release
cargo clippy --release -- -D warnings
cargo machete
cd ../third_party/ipatool-shuttle
test -z "$(gofmt -l .)"
go test ./...
go vet ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./...
cd ../../src-tauri
cargo audit
```

Frontend tests cover language switching, auth states, list sorting/search,
selection stability, shared library synchronization, Activity Log behavior,
missing IPA deletion, device refresh, battery states, and error wording.

Rust tests cover XML parsing and size calculation, icon validation, strict and
atomic storage behavior, path containment, log redaction, auth session call
counts and stale operations, human error mapping, and process timeout/reaping.
The vendored Go suite covers the Apple request/auth/download core and verifies
that a password is not serialized into session storage.

Coverage thresholds are statements 70%, branches 60%, functions 65%, and
lines 70%. Tauri bootstrap and the interactive auth sheet are excluded from
frontend coverage; their core state and API behavior are exercised below the
UI boundary.

Run focused release stability checks with `scripts/check-memory.sh`. Full GUI
Miri/ASan coverage is not practical for WebKit/Tauri; pure Rust modules remain
separately testable and the script optionally invokes macOS `leaks`.

## Manual E2E Checklist

Use only `src-tauri/target/release/bundle/macos/IPA Shuttle.app`:

- Launch and verify no Keychain prompt appears.
- Refresh iPhone, scan apps, and verify name, bundle ID, version, size, battery,
  icons or monograms, and EN/RU UI.
- Verify the initial list appears before data sizes, then use `Load data sizes`
  and confirm selection, search, and sorting remain unchanged.
- Sign in with Apple ID, complete 2FA, and optionally remember the session.
- Download two IPA files; verify no Keychain prompt during downloads, scan,
  refresh, navigation, or install-screen reconciliation.
- Delete one IPA in the GUI, verify both screens update, then download it again.
- Restart, click `Use saved session` once, and download another IPA without a
  second Keychain prompt.
- Connect the target iPhone and install a downloaded IPA.
- Remove a missing manifest entry and verify it stays removed after restart.
- Clear logs under All, Warnings, and Errors and verify old entries do not return.

Do not mark a release production-ready until this complete auth, download,
delete/re-download, and install sequence passes on the built app.
