# Оформление DMG

Файлы оформления остаются в `src-tauri/dmg/`. `background.svg` является редактируемым векторным источником окна Finder 660 × 400. Из этого каталога PNG экспортируются штатными командами:

```bash
sips -s format png -z 400 660 background.svg --out background.png
sips -s format png -z 800 1320 background.svg --out background@2x.png
sips -s dpiWidth 72 -s dpiHeight 72 background.png
sips -s dpiWidth 144 -s dpiHeight 144 background@2x.png
```

Tauri использует PNG двойного размера. Подсказка и стрелка должны оставаться вне позиций иконок из `src-tauri/tauri.conf.json`.

Из корня репозитория `pnpm build:dmg` собирает образ, применяет метаданные Finder, скрывает служебные файлы, монтирует и проверяет установщик. Не редактируйте и не добавляйте сгенерированные `.DS_Store` вне временного DMG volume.
