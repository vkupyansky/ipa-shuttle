[![Русский](https://img.shields.io/badge/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-181717?style=for-the-badge)](README.ru.md)

# IPA Shuttle

A macOS application that scans user-installed apps on a connected iPhone, downloads Apple-provided IPA files for your own Apple ID, and installs local IPA files on another iPhone.

**[Download v0.1.0 DMG for Apple Silicon](https://github.com/vkupyansky/ipa-shuttle/releases/download/v0.1.0/IPA_Shuttle_0.1.0_aarch64.dmg)** · [Release notes and SHA256SUMS](https://github.com/vkupyansky/ipa-shuttle/releases/tag/v0.1.0)

## Features

- User-installed app names and versions, search and sorting.
- A separate app-data size request that does not delay the initial scan.
- Apple ID sign-in with two-factor authentication and a local IPA library.
- Installation on a target iPhone, a shared Activity Log, and English/Russian UI.

### Apps & IPA

![The connected iPhone's scanned apps](docs/images/apps-list.png)

### Install and Activity Log

![The local IPA library and Activity Log](docs/images/install-library.png)

## Install and run

Requires macOS 13 or newer and an Apple Silicon Mac. The release and bundled engines are arm64 only.

1. Download the DMG above, open it and drag IPA Shuttle to Applications.
2. Launch the app. The v0.1.0 build is ad-hoc signed and not notarized. If macOS blocks it, see [Apple's instructions](https://support.apple.com/en-sg/102445) for the manual confirmation flow.
3. Connect and unlock the iPhone, then confirm that it trusts this computer.

## Usage

1. Click **Scan apps**. The list appears before app-data sizes; use **Load data sizes** separately when needed.
2. Sign in with your Apple ID and complete 2FA. Select apps available to that account and download their IPA files to the local library.
3. Connect the target iPhone, open Install and choose a local IPA.

Passwords and 2FA codes stay in memory. You may remember a session in one app-owned Keychain item; **Use saved session** reads it once. Background checks, scans and downloads never read Keychain.

IPA files live in `~/Library/Application Support/IPA Shuttle/Library/`. Deleting an IPA removes only its file and library entry, never an app from the iPhone. Logs live in `~/Library/Logs/IPA Shuttle/`, are retained for 7 days and rotate at 5 MB with 3 archives; the GUI shows at most 200 events. Clear Logs removes the current file and archives. Other paths are listed in the [architecture guide](docs/architecture.md#данные).

## Checks

Development requires Xcode Command Line Tools, Node.js 24 LTS, pnpm 11, Rust stable, Go 1.26 and Tauri CLI 2. Bundled engines must already be prepared under `src-tauri/resources/bin/`; manifests and lockfiles record exact dependencies.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The complete Rust/Go/coverage/audit gate and real-device checklist are in [testing](docs/testing.md). Build a DMG separately with `pnpm build:dmg`; signing, notarization and artifact paths are covered in the [release guide](docs/release.md).

## Limitations

- v0.1.0 is a pre-release.
- Apple must still provide the app for your Apple ID; the target iPhone may require the same account.
- Remembered sessions are experimental in a locally signed build; memory-only sign-in remains the default.
- The current build is not notarized. Stable Keychain identity for distribution requires Developer ID signing and Apple notarization.
- IPA Shuttle is independent of Apple. It does not extract IPA files from installed apps, bypass DRM, jailbreak, crack, patch, re-sign or share apps.

## Documentation

Technical guides are maintained in Russian:

- [Architecture and storage](docs/architecture.md).
- [Testing](docs/testing.md), [releases](docs/release.md) and [DMG artwork](docs/dmg-artwork.md).
- [Security](SECURITY.md) and [contributing](CONTRIBUTING.md).

## License

The bundled-engine distribution is [GPL-2.0-or-later](LICENSE). Component licences and the ipatool engine's original MIT text are preserved; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). IPA files, credentials, caches, logs and signing secrets do not belong in the repository.
