# Release

Release acceptance uses the built `.app`; never use `tauri dev`.

## Gate

Run every command in [TESTING.md](TESTING.md), then:

```bash
cd src-tauri
cargo tauri build
codesign --verify --deep --strict "target/release/bundle/macos/IPA Shuttle.app"
cd ..
pnpm build:dmg
hdiutil verify "src-tauri/target/release/bundle/dmg/IPA_Shuttle_0.1.0_aarch64.dmg"
```

Artifacts are created at:

- `src-tauri/target/release/bundle/macos/IPA Shuttle.app`
- `src-tauri/target/release/bundle/dmg/IPA_Shuttle_<version>_<arch>.dmg`

`pnpm build:dmg` is idempotent. It builds release bundles, applies the Finder
layout, hides `.VolumeIcon.icns`, `.background`, and `.DS_Store`, verifies the
app signature, mounts the image, and confirms only the app and Applications
link are visible. Artwork lives in `src-tauri/dmg/`.

## Signing and Notarization

The stable bundle identifier is `app.ipashuttle.desktop`. Public releases need
one persistent `Developer ID Application` identity, hardened runtime, Apple
notarization, and a stapled ticket. Set:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" pnpm build:dmg
```

Local builds use the configured ad-hoc identity (`-`) so the complete bundle,
including Resources, is sealed and verifiable. `APPLE_SIGNING_IDENTITY`
overrides that default for a Developer ID build.

The DMG script intentionally refuses notarization variables before Finder
post-processing. Notarize and staple the final underscore-named DMG afterward.
Without credentials, the script produces an ad-hoc local artifact; remembered
Keychain sessions remain experimental and memory-only auth is the default.

Complete the built-app checklist in [TESTING.md](TESTING.md) before calling a
release production-ready. In particular, verify login + 2FA, download,
delete/re-download, saved-session reuse, and target installation.
