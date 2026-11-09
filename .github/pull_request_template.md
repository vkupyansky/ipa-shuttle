## Что изменилось

Опишите задачу и результат для пользователя.

## Проверки

Рабочие каталоги и полный порядок команд: [тестирование](https://github.com/vkupyansky/ipa-shuttle/blob/main/docs/testing.md).

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
- [ ] `gofmt`, `go test ./...`, `go vet ./...` и `govulncheck`

## Данные и границы проекта

- [ ] В коммите нет паролей Apple ID, кодов 2FA, auth tokens, cookies, IPA, журналов, manifests, кэшей иконок, сертификатов и credentials нотарификации.
- [ ] Не добавлены jailbreak, снятие DRM, взлом, патчи, переподпись, распространение IPA или извлечение IPA из установленных приложений iPhone.
