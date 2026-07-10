## Summary

## Checks

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:coverage`
- [ ] `pnpm i18n:check`
- [ ] `pnpm build`
- [ ] `pnpm knip`
- [ ] `pnpm audit --audit-level=low`
- [ ] `cargo fmt --check`
- [ ] `cargo test --release`
- [ ] `cargo clippy --release -- -D warnings`
- [ ] `cargo machete`
- [ ] `cargo audit`
- [ ] `gofmt`, `go test ./...`, `go vet ./...`, and `govulncheck`

## Security

- [ ] No Apple ID passwords, 2FA codes, auth tokens, cookies, IPA files, logs,
      manifests, icon caches, certificates, or notarization credentials are
      committed.
- [ ] No jailbreak, DRM bypass, cracking, patching, re-signing, IPA sharing, or
      IPA extraction from installed iPhone apps is added.
