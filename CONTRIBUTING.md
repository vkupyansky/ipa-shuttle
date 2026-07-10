# Contributing

Keep IPA Shuttle macOS-only, GUI-driven, and scoped to Apple-provided apps from
the user's own account. Do not add terminal UX, jailbreak, DRM bypass,
cracking, patching, re-signing, IPA extraction, or IPA sharing.

Preserve these boundaries:

- Frontend calls only typed Tauri commands.
- Commands stay thin; testable behavior belongs in Rust core/engine modules.
- Sidecars never own Keychain state.
- Passwords, 2FA, tokens, cookies, session JSON, private device identifiers,
  IPA files, logs, caches, manifests, certificates, and notarization secrets
  must not enter commits, fixtures, screenshots, or diagnostics.
- Every user-facing string has matching EN/RU catalog entries.
- Add an abstraction only when it removes actual duplication.

Run the complete gate in [TESTING.md](TESTING.md), including `pnpm knip`,
`cargo machete`, Go formatting/tests/vet, and the release Rust checks. Use the
built `.app`, not `tauri dev`, for GUI acceptance. Update architecture,
security, release, testing, and third-party notices when their facts change.

The current bundled distribution is `GPL-2.0-or-later`; preserve all upstream
license files and notices.
