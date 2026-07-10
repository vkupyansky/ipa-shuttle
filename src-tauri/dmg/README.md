# DMG artwork

`background.svg` is the editable vector source for the 660 x 400 Finder
window. The committed PNG files are deterministic exports:

```bash
sips -s format png -z 400 660 background.svg --out background.png
sips -s format png -z 800 1320 background.svg --out background@2x.png
sips -s dpiWidth 72 -s dpiHeight 72 background.png
sips -s dpiWidth 144 -s dpiHeight 144 background@2x.png
```

Tauri uses the 2x PNG. Keep the instruction and arrow clear of the icon
positions configured in `src-tauri/tauri.conf.json`.

Run `pnpm build:dmg` from the repository root to build, apply Finder metadata,
hide service files, mount, and validate the final installer. Do not edit or
commit generated `.DS_Store` files outside the temporary DMG volume.
