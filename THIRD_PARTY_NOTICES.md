# Third-Party Notices

This summary is not legal advice. Release maintainers must preserve upstream
notices, corresponding source availability, and license obligations.

## ipatool-shuttle

`third_party/ipatool-shuttle/` is a modified fork of Majd Alfhaily's `ipatool`
(MIT). IPA Shuttle keeps only the internal auth-login and download CLI surface,
replaces persistent keychain behavior with a memory/private-file bridge, and
does not store passwords. The upstream MIT text is preserved in
`third_party/ipatool-shuttle/LICENSE`.

## Bundled iPhone Engines

The current Apple Silicon bundle was assembled from these stable Homebrew
packages and their transitive libraries:

| Component | Version | License |
| --- | --- | --- |
| ideviceinstaller | 1.2.0 | GPL-2.0-or-later |
| libimobiledevice | 1.4.0 | LGPL-2.1-or-later |
| libimobiledevice-glue | 1.3.2 | LGPL-2.1-or-later |
| libplist | 2.7.0 | LGPL-2.1-or-later |
| libusbmuxd | 2.1.1 | GPL-2.0-or-later AND LGPL-2.1-or-later |
| libzip | 1.11.4 | BSD-3-Clause |
| OpenSSL | 3.6.3 | Apache-2.0 |
| xz/liblzma | 5.8.3 | 0BSD AND GPL-2.0-or-later |
| zstd | 1.5.7 | BSD/GPL/MIT components; see upstream |

Upstream source and license information:

- <https://github.com/libimobiledevice/ideviceinstaller>
- <https://github.com/libimobiledevice/libimobiledevice>
- <https://github.com/libimobiledevice/libimobiledevice-glue>
- <https://github.com/libimobiledevice/libplist>
- <https://github.com/libimobiledevice/libusbmuxd>
- <https://github.com/nih-at/libzip>
- <https://github.com/openssl/openssl>
- <https://github.com/tukaani-project/xz>
- <https://github.com/facebook/zstd>

Because GPL-covered engines are bundled in the `.app`, IPA Shuttle uses
`GPL-2.0-or-later`. Re-evaluate licensing before changing this packaging model.

## Application Dependencies

React, Lucide, Tauri, Rust crates, Go modules, and build/test packages are
declared in `package.json`, `src-tauri/Cargo.toml`, and
`third_party/ipatool-shuttle/go.mod`; their lockfiles record exact versions.
IPA Shuttle does not bundle Apple logos, SF Symbols fonts, or Apple artwork.
