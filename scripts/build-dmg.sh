#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_PATH="$ROOT_DIR/src-tauri/tauri.conf.json"
DMG_DIR="$ROOT_DIR/src-tauri/target/release/bundle/dmg"
APP_BUNDLE="$ROOT_DIR/src-tauri/target/release/bundle/macos/IPA Shuttle.app"
VOLUME_ICON="$ROOT_DIR/src-tauri/icons/icon.icns"
BACKGROUND_1X="$ROOT_DIR/src-tauri/dmg/background.png"
BACKGROUND_2X="$ROOT_DIR/src-tauri/dmg/background@2x.png"
SETFILE="$(xcrun -f SetFile 2>/dev/null || true)"
GETFILEINFO="$(xcrun -f GetFileInfo 2>/dev/null || true)"

MOUNT_DEVICE=""
MOUNT_POINT=""
RW_IMAGE=""

log() {
  printf '[build:dmg] %s\n' "$*"
}

fail() {
  printf '[build:dmg] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1"
}

cleanup() {
  if [[ -n "$MOUNT_DEVICE" ]]; then
    hdiutil detach "$MOUNT_DEVICE" >/dev/null 2>&1 || true
    MOUNT_DEVICE=""
    MOUNT_POINT=""
  fi
  if [[ -n "$RW_IMAGE" && -f "$RW_IMAGE" ]]; then
    rm -f "$RW_IMAGE"
  fi
}

trap cleanup EXIT INT TERM

attach_image() {
  local image_path="$1"
  local mode="$2"
  local output

  output="$(hdiutil attach "-$mode" -noverify -noautoopen -nobrowse "$image_path")"
  MOUNT_DEVICE="$(printf '%s\n' "$output" | awk '/\/Volumes\// { print $1; exit }')"
  MOUNT_POINT="$(printf '%s\n' "$output" | sed -n 's#^.*\(/Volumes/.*\)$#\1#p' | head -n 1)"

  [[ -n "$MOUNT_DEVICE" && -n "$MOUNT_POINT" ]] || fail "Could not locate the mounted DMG volume."
}

detach_image() {
  [[ -n "$MOUNT_DEVICE" ]] || return 0
  hdiutil detach "$MOUNT_DEVICE" >/dev/null
  MOUNT_DEVICE=""
  MOUNT_POINT=""
}

apply_finder_chrome() {
  local volume_name
  volume_name="$(basename "$MOUNT_POINT")"

  osascript - "$volume_name" <<'APPLESCRIPT' >/dev/null
on run argv
  set volumeName to item 1 of argv
  tell application "Finder"
    tell disk volumeName
      open
      tell container window
        set toolbar visible to false
        set statusbar visible to false
        set pathbar visible to false
      end tell
      close
      open
      delay 1
      close
    end tell
  end tell
end run
APPLESCRIPT
}

assert_hidden() {
  local path="$1"
  local attributes
  attributes="$($GETFILEINFO -a "$path")"
  [[ "$attributes" == *V* ]] || fail "Finder invisible flag is missing: $(basename "$path")"
}

assert_png_geometry() {
  local path="$1"
  local expected_width="$2"
  local expected_height="$3"
  local expected_dpi="$4"
  local width height dpi

  width="$(sips -g pixelWidth "$path" | awk '/pixelWidth:/ { print $2 }')"
  height="$(sips -g pixelHeight "$path" | awk '/pixelHeight:/ { print $2 }')"
  dpi="$(sips -g dpiWidth "$path" | awk '/dpiWidth:/ { print $2 }')"

  [[ "$width" == "$expected_width" && "$height" == "$expected_height" ]] || fail "Unexpected PNG size: $(basename "$path")"
  awk -v actual="$dpi" -v expected="$expected_dpi" 'BEGIN { exit !((actual + 0) == (expected + 0)) }' || fail "Unexpected PNG DPI: $(basename "$path")"
}

require_command cargo
require_command hdiutil
require_command node
require_command osascript
require_command rustc
require_command codesign
require_command sips
[[ -n "$SETFILE" && -x "$SETFILE" ]] || fail "SetFile is required. Install the stable Xcode Command Line Tools."
[[ -n "$GETFILEINFO" && -x "$GETFILEINFO" ]] || fail "GetFileInfo is required. Install the stable Xcode Command Line Tools."
[[ -f "$VOLUME_ICON" ]] || fail "Volume icon is missing: src-tauri/icons/icon.icns"
[[ -f "$BACKGROUND_1X" && -f "$BACKGROUND_2X" ]] || fail "DMG background PNG files are missing."
assert_png_geometry "$BACKGROUND_1X" 660 400 72
assert_png_geometry "$BACKGROUND_2X" 1320 800 144

if [[ -n "${APPLE_ID:-}${APPLE_PASSWORD:-}${APPLE_TEAM_ID:-}${APPLE_API_KEY:-}${APPLE_API_ISSUER:-}${APPLE_API_KEY_PATH:-}" ]]; then
  fail "Notarization variables are set. Build the post-processed DMG without them, then notarize and staple the final underscore-named image."
fi

VERSION="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(c.version);' "$CONFIG_PATH")"
HOST_TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
case "$HOST_TRIPLE" in
  aarch64-apple-darwin) ARCH="aarch64" ;;
  x86_64-apple-darwin) ARCH="x64" ;;
  *) fail "Unsupported macOS Rust host: $HOST_TRIPLE" ;;
esac

SOURCE_DMG="$DMG_DIR/IPA Shuttle_${VERSION}_${ARCH}.dmg"
FINAL_DMG="$DMG_DIR/IPA_Shuttle_${VERSION}_${ARCH}.dmg"
RW_IMAGE="$DMG_DIR/.IPA_Shuttle_${VERSION}_${ARCH}_rw.dmg"

rm -f "$SOURCE_DMG" "$FINAL_DMG" "$RW_IMAGE"

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  export APPLE_SIGNING_IDENTITY="-"
  log "APPLE_SIGNING_IDENTITY is unset; using an ad-hoc signature for local validation."
fi

log "Building release app and Tauri DMG."
cd "$ROOT_DIR"
cargo tauri build --bundles app,dmg

[[ -d "$APP_BUNDLE" ]] || fail "Release app bundle was not created."
[[ -f "$SOURCE_DMG" ]] || fail "Tauri DMG was not created: $SOURCE_DMG"
codesign --verify --deep --strict "$APP_BUNDLE"

log "Applying Finder-invisible flags to service files."
hdiutil convert "$SOURCE_DMG" -quiet -format UDRW -o "$RW_IMAGE"
attach_image "$RW_IMAGE" readwrite

[[ -d "$MOUNT_POINT/IPA Shuttle.app" ]] || fail "IPA Shuttle.app is missing from the DMG."
[[ -L "$MOUNT_POINT/Applications" ]] || fail "Applications link is missing from the DMG."
[[ "$(readlink "$MOUNT_POINT/Applications")" == "/Applications" ]] || fail "Applications link has an unexpected target."
[[ -f "$MOUNT_POINT/.VolumeIcon.icns" ]] || fail "The hidden volume icon is missing."
[[ -d "$MOUNT_POINT/.background" ]] || fail "The hidden background folder is missing."
[[ -f "$MOUNT_POINT/.DS_Store" ]] || fail "Finder layout metadata is missing."

apply_finder_chrome
"$SETFILE" -c icnC "$MOUNT_POINT/.VolumeIcon.icns"
"$SETFILE" -a V "$MOUNT_POINT/.VolumeIcon.icns"
"$SETFILE" -a V "$MOUNT_POINT/.background"
"$SETFILE" -a V "$MOUNT_POINT/.DS_Store"
"$SETFILE" -a C "$MOUNT_POINT"
sync
detach_image

log "Compressing the final installer image."
hdiutil convert "$RW_IMAGE" -quiet -format UDZO -imagekey zlib-level=9 -o "$FINAL_DMG"
rm -f "$RW_IMAGE" "$SOURCE_DMG"
RW_IMAGE=""

if [[ "$APPLE_SIGNING_IDENTITY" != "-" ]]; then
  log "Signing the final DMG with $APPLE_SIGNING_IDENTITY."
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" "$FINAL_DMG"
  codesign --verify --strict "$FINAL_DMG"
fi

log "Mounting and validating the final DMG."
hdiutil verify "$FINAL_DMG" >/dev/null
attach_image "$FINAL_DMG" readonly

[[ -d "$MOUNT_POINT/IPA Shuttle.app" ]] || fail "Final DMG does not contain IPA Shuttle.app."
[[ -L "$MOUNT_POINT/Applications" ]] || fail "Final DMG does not contain the Applications link."
[[ "$(readlink "$MOUNT_POINT/Applications")" == "/Applications" ]] || fail "Final Applications link has an unexpected target."
[[ ! -e "$MOUNT_POINT/VolumeIcon.icns" ]] || fail "A visible VolumeIcon.icns file is present."
[[ -f "$MOUNT_POINT/.VolumeIcon.icns" ]] || fail "Final hidden volume icon is missing."
[[ -d "$MOUNT_POINT/.background" ]] || fail "Final hidden background folder is missing."
[[ -f "$MOUNT_POINT/.DS_Store" ]] || fail "Final Finder layout metadata is missing."

assert_hidden "$MOUNT_POINT/.VolumeIcon.icns"
assert_hidden "$MOUNT_POINT/.background"
assert_hidden "$MOUNT_POINT/.DS_Store"
[[ "$($GETFILEINFO -a "$MOUNT_POINT")" == *C* ]] || fail "The DMG volume does not have a custom icon flag."
cmp -s "$MOUNT_POINT/.VolumeIcon.icns" "$VOLUME_ICON" || fail "The DMG volume icon does not match the app icon."

VISIBLE_ITEMS="$(find "$MOUNT_POINT" -mindepth 1 -maxdepth 1 ! -name '.*' -exec basename {} \; | LC_ALL=C sort)"
EXPECTED_ITEMS="$(printf '%s\n' Applications 'IPA Shuttle.app' | LC_ALL=C sort)"
[[ "$VISIBLE_ITEMS" == "$EXPECTED_ITEMS" ]] || fail "Unexpected visible root items: $VISIBLE_ITEMS"

codesign --verify --deep --strict "$MOUNT_POINT/IPA Shuttle.app"
detach_image

log "Validated installer: $FINAL_DMG"
