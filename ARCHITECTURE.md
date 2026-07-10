# Architecture

IPA Shuttle is a macOS-only Tauri v2 application. React/TypeScript owns the
two-screen GUI (`Apps & IPA`, `Install`) and calls typed Tauri commands. It has
no knowledge of bundled engines or command-line arguments.

## Runtime Layers

- `src/app`, `components`, and `features`: UI flow and shared IPA library state.
- `src/i18n`: complete EN/RU catalogs; missing or unused keys fail the build.
- `src/lib/api.ts`: the single typed Tauri invocation boundary.
- `src-tauri/src/core`: devices, apps, auth, IPA library, install, storage,
  errors, and structured logging.
- `src-tauri/src/engine`: allow-listed bundled paths and argv-only process
  execution behind `ProcessRunner`, with sanitized environments and timeouts.
- `third_party/ipatool-shuttle`: isolated MIT-licensed auth/download engine.

Tauri commands remain thin and move blocking work off the UI thread. Initial
app scan excludes `DynamicDiskUsage`, returns XML-derived rows immediately,
and starts the separate icon batch afterward. Data sizes use one explicit,
cancelable background request guarded by scan generation; they never block the
initial list. The frontend IPA library store is the shared source of truth for
both screens.

## Storage

The manifest and icon metadata schemas are strict. Manifest read-modify-write
operations share one lock and use 0600 atomic replacement files. IPA paths are
canonicalized, restricted to the app Library, and checked for a non-empty ZIP
signature before installation. Icon and manifest symlinks are rejected.

Logs are structured JSON lines, redacted before writing, retained for 7 days,
and rotated at 5 MB with 3 archives. Files use 0600 and directories 0700.

## Authentication

Passwords and 2FA codes exist only in memory and are sent to the live auth
process through stdin. The auth child is killed and reaped on cancel, timeout,
or drop. Session IPC uses a unique 0600 file in a 0700 directory and removes it
on every exit path.

Remembered sessions use exactly one Keychain item owned by the IPA Shuttle
process: `com.ipashuttle.apple-session.v2/active`. `Use saved session` reads it
once into `AuthSessionManager`; downloads use only that memory cache. Startup,
navigation, scans, and device refreshes never query Keychain.

## Platform Boundary

The default Tauri capability grants only `core:default`. The asset protocol is
scoped to the icon cache, and CSP disallows objects, frames, forms, and remote
content. Bundled engine paths must resolve to executable regular files inside
the app Resources allow-list.
