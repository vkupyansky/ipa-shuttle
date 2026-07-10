# Security Policy

Report vulnerabilities privately to the maintainer before public disclosure.
Include a concise impact statement, reproduction steps, and affected version.
Never attach real passwords, 2FA codes, session JSON, cookies, IPA files,
Keychain exports, signing keys, or unreviewed diagnostics.

## Security Invariants

- Apple ID passwords and 2FA codes exist only in memory and are sent by stdin.
- Session material exists only in Rust memory, a short-lived 0600 IPC file, or
  one app-owned Keychain item: `com.ipashuttle.apple-session.v2/active`.
- Sidecars never call `SecItem*`; the Go engine uses only the supplied session
  file or memory. Its Security.framework symbols are limited to TLS trust.
- Startup, navigation, device refresh, scan, and download never read Keychain.
  `Use saved session` is the single explicit read.
- Logs redact credentials, tokens, cookies, session material, sensitive device
  identifiers, and the user's absolute home path before diagnostics export.
- Processes use allow-listed bundled regular files, argv arrays, a sanitized
  environment, bounded timeouts, and kill/wait on timeout. Auth children are
  also killed on cancel or drop.
- Manifest updates are locked and atomic. IPA access is canonicalized to the
  local Library; symlinks, outside paths, empty files, and non-ZIP files fail.
- Tauri grants only `core:default`; local asset access is scoped to Icons, and
  CSP blocks remote content, objects, frames, forms, and base URL changes.

## Audit Snapshot (2026-07-10)

The pre-publication audit restricted diagnostics paths, added private file
modes and atomic storage, consolidated process execution, and regenerated
current Go test mocks. `pnpm audit` reports no known npm vulnerabilities. The
Go engine is rebuilt with Go 1.26.5 and `govulncheck` reports no reachable
vulnerabilities. `cargo audit` reports no vulnerability failures; it reports
17 maintenance warnings, including Linux-only GTK3 crates and one GTK `glib`
advisory outside the Apple Silicon graph. Active Tauri `urlpattern/unic-*`
maintenance warnings remain upstream risk. Rerun all audits for every release.
Third-party licenses are summarized in `THIRD_PARTY_NOTICES.md`.

Residual release risks:

- Ad-hoc signatures do not provide stable Keychain ACL identity; use a stable
  Developer ID for distribution or keep sessions memory-only.
- Download/install jobs are bounded but do not expose a user cancellation
  control in the current MVP.
- Apple's availability and private App Store behavior can change independently.
- A full real-device auth, download, delete/re-download, and install E2E is
  required before any build is described as production-ready.

Jailbreak, DRM bypass, cracking, patching, re-signing, IPA sharing, and IPA
extraction from installed iPhone apps are out of scope.
