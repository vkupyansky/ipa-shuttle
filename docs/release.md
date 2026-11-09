# Подготовка выпуска

Приёмка выполняется на собранном `.app`; `tauri dev` для неё не используется.

## Проверки и артефакты

Выполните все команды из [тестирования](testing.md), затем:

```bash
cd src-tauri
cargo tauri build
codesign --verify --deep --strict "target/release/bundle/macos/IPA Shuttle.app"
cd ..
pnpm build:dmg
hdiutil verify "src-tauri/target/release/bundle/dmg/IPA_Shuttle_0.1.0_aarch64.dmg"
```

Артефакты:

- `src-tauri/target/release/bundle/macos/IPA Shuttle.app`.
- `src-tauri/target/release/bundle/dmg/IPA_Shuttle_<version>_<arch>.dmg`.

Команда `pnpm build:dmg` идемпотентна. Она собирает release bundles, задаёт размещение Finder, скрывает `.VolumeIcon.icns`, `.background` и `.DS_Store`, проверяет подпись, монтирует образ и подтверждает, что видимы только приложение и ссылка Applications. Материалы находятся в `src-tauri/dmg/`; [инструкция по оформлению](dmg-artwork.md).

TypeScript закреплён на 6.0.3. Переход на TypeScript 7 отложен до поддержки выбранным стабильным typescript-eslint без beta, RC и предупреждений совместимости.

## Подпись и нотарификация

Постоянный bundle identifier: `app.ipashuttle.desktop`. Для распространения нужны постоянная identity Developer ID Application, hardened runtime, нотарификация Apple и stapled ticket:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" pnpm build:dmg
```

Локальные сборки используют настроенную ad-hoc identity `-`: весь bundle, включая Resources, запечатан и проверяем. `APPLE_SIGNING_IDENTITY` заменяет её при сборке с Developer ID.

DMG-скрипт намеренно отклоняет переменные нотарификации до окончательной обработки Finder. Нотарифицируйте и staple-ите конечный DMG с подчёркиваниями в имени после неё. Без credentials создаётся локальный ad-hoc артефакт; сохранённые Keychain-сессии остаются экспериментальными, вход только в памяти используется по умолчанию.

До признания выпуска готовым пройдите [сценарий на устройствах](testing.md#сценарий-на-устройствах): вход и 2FA, скачивание, удаление/повторное скачивание, использование сохранённой сессии и установка на целевой iPhone.
