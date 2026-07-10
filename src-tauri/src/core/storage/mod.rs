use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Cursor, Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    errors::AppError,
    models::{LocalIpa, LocalIpaStatus, Manifest, ManifestItem, ManifestItemStatus},
};

pub const ICON_CACHE_VERSION: u32 = 2;
const APP_DIR_NAME: &str = "IPA Shuttle";
const MANIFEST_FILE: &str = "manifest.json";
const LIBRARY_DIR: &str = "Library";
const ICONS_DIR: &str = "Icons";
const MIN_ICON_FILE_SIZE: u64 = 2 * 1024;
const MIN_ICON_DIMENSION: u32 = 40;
static MANIFEST_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone)]
pub struct IconCacheLookup {
    pub path: PathBuf,
    pub metadata_path: PathBuf,
    pub exists: bool,
    pub metadata_version: Option<u32>,
    pub valid: bool,
    pub validation_result: String,
    pub file_size: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub sha256: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IconCacheMetadata {
    icon_cache_version: u32,
    bundle_id: String,
    updated_at: String,
    file_size: u64,
    width: u32,
    height: u32,
    sha256: String,
}

pub fn app_support_dir() -> Result<PathBuf, AppError> {
    dirs::data_dir()
        .map(|path| path.join(APP_DIR_NAME))
        .ok_or_else(|| AppError::storage("Unable to resolve Application Support directory"))
}

pub fn library_dir() -> Result<PathBuf, AppError> {
    Ok(app_support_dir()?.join(LIBRARY_DIR))
}

pub fn icons_dir() -> Result<PathBuf, AppError> {
    Ok(app_support_dir()?.join(ICONS_DIR))
}

pub fn manifest_path() -> Result<PathBuf, AppError> {
    Ok(app_support_dir()?.join(MANIFEST_FILE))
}

pub fn ensure_app_dirs() -> Result<(), AppError> {
    ensure_private_dir(&app_support_dir()?)?;
    ensure_private_dir(&library_dir()?)?;
    ensure_private_dir(&icons_dir()?)?;
    ensure_private_dir(&crate::logging::log_dir()?)?;
    if !manifest_path()?.exists() {
        write_manifest(&Manifest::default())?;
    }
    Ok(())
}

pub fn read_manifest() -> Result<Manifest, AppError> {
    let _guard = lock_manifest()?;
    read_manifest_unlocked()
}

fn read_manifest_unlocked() -> Result<Manifest, AppError> {
    let path = manifest_path()?;
    if !path.exists() {
        return Ok(Manifest::default());
    }
    if !fs::symlink_metadata(&path)?.file_type().is_file() {
        return Err(AppError::storage("Manifest is not a regular file"));
    }

    let raw = fs::read_to_string(&path)
        .map_err(|err| AppError::storage(format!("Failed to read {}: {err}", path.display())))?;
    if raw.trim().is_empty() {
        return Ok(Manifest::default());
    }

    serde_json::from_str(&raw)
        .map_err(|err| AppError::storage(format!("Failed to parse {}: {err}", path.display())))
}

pub fn write_manifest(manifest: &Manifest) -> Result<(), AppError> {
    let _guard = lock_manifest()?;
    write_manifest_unlocked(manifest)
}

fn write_manifest_unlocked(manifest: &Manifest) -> Result<(), AppError> {
    ensure_private_dir(&app_support_dir()?)?;
    let path = manifest_path()?;
    let raw = serde_json::to_string_pretty(manifest)
        .map_err(|err| AppError::storage(format!("Failed to encode manifest: {err}")))?;
    atomic_write_private(&path, raw.as_bytes())
}

pub fn upsert_manifest_item(item: ManifestItem) -> Result<ManifestItem, AppError> {
    let _guard = lock_manifest()?;
    let mut manifest = read_manifest_unlocked()?;
    manifest
        .items
        .retain(|existing| existing.bundle_id != item.bundle_id || existing.id == item.id);

    if let Some(existing) = manifest
        .items
        .iter_mut()
        .find(|existing| existing.id == item.id)
    {
        *existing = item.clone();
    } else {
        manifest.items.push(item.clone());
    }

    write_manifest_unlocked(&manifest)?;
    Ok(item)
}

pub fn update_manifest_icon(
    bundle_id: &str,
    icon_path: &str,
    icon_updated_at: Option<&str>,
    icon_cache_version: Option<u32>,
) -> Result<(), AppError> {
    let _guard = lock_manifest()?;
    let mut manifest = read_manifest_unlocked()?;
    let mut changed = false;

    for item in manifest
        .items
        .iter_mut()
        .filter(|item| item.bundle_id == bundle_id)
    {
        item.icon_path = Some(icon_path.to_string());
        item.icon_updated_at = icon_updated_at.map(ToOwned::to_owned);
        item.icon_cache_version = icon_cache_version;
        changed = true;
    }

    if changed {
        write_manifest_unlocked(&manifest)?;
    }

    Ok(())
}

pub fn list_local_ipas() -> Result<Vec<LocalIpa>, AppError> {
    let manifest = read_manifest()?;
    let library = library_dir()?;
    Ok(manifest
        .items
        .into_iter()
        .map(|item| manifest_item_to_local_ipa_in(item, &library))
        .collect())
}

pub fn find_local_ipa(ipa_id: &str) -> Result<Option<LocalIpa>, AppError> {
    Ok(list_local_ipas()?
        .into_iter()
        .find(|item| item.id == ipa_id))
}

pub fn delete_local_ipas(ipa_ids: &[String]) -> Result<usize, AppError> {
    let ids = ipa_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>();

    if ids.is_empty() {
        return Ok(0);
    }

    let _guard = lock_manifest()?;
    let library = library_dir()?;
    let (manifest, removed) = remove_local_ipa_items(read_manifest_unlocked()?, &ids, &library)?;

    write_manifest_unlocked(&manifest)?;
    Ok(removed)
}

fn remove_local_ipa_items(
    manifest: Manifest,
    ids: &HashSet<String>,
    library: &Path,
) -> Result<(Manifest, usize), AppError> {
    let mut removed = 0;
    let mut retained_items = Vec::new();

    for item in manifest.items {
        if !ids.contains(&item.id) {
            retained_items.push(item);
            continue;
        }

        let ipa_path = PathBuf::from(&item.ipa_path);
        if ipa_path.exists() && is_deletable_library_ipa(&ipa_path, library) {
            fs::remove_file(&ipa_path).map_err(|err| {
                AppError::storage(format!("Failed to remove {}: {err}", ipa_path.display()))
            })?;
        }

        removed += 1;
    }

    Ok((
        Manifest {
            items: retained_items,
        },
        removed,
    ))
}

pub fn manifest_item_to_local_ipa(item: ManifestItem) -> LocalIpa {
    let library = library_dir().ok();
    manifest_item_to_local_ipa_in_optional(item, library.as_deref())
}

fn manifest_item_to_local_ipa_in(item: ManifestItem, library: &Path) -> LocalIpa {
    manifest_item_to_local_ipa_in_optional(item, Some(library))
}

fn manifest_item_to_local_ipa_in_optional(item: ManifestItem, library: Option<&Path>) -> LocalIpa {
    let status = if library
        .is_some_and(|library| ipa_file_is_available_in_library(Path::new(&item.ipa_path), library))
    {
        LocalIpaStatus::Downloaded
    } else {
        LocalIpaStatus::Missing
    };
    let icon_lookup = validate_icon_cache(&item.bundle_id)
        .ok()
        .filter(|lookup| lookup.valid);

    LocalIpa {
        id: item.id,
        bundle_id: item.bundle_id,
        app_name: item.app_name,
        ipa_path: item.ipa_path,
        downloaded_at: item.downloaded_at,
        icon_path: icon_lookup
            .as_ref()
            .map(|lookup| lookup.path.to_string_lossy().to_string()),
        icon_updated_at: icon_lookup
            .as_ref()
            .and_then(|lookup| lookup.updated_at.clone()),
        icon_cache_version: icon_lookup.map(|_| ICON_CACHE_VERSION),
        status,
    }
}

fn ipa_file_is_available_in_library(path: &Path, library: &Path) -> bool {
    let valid_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ipa"));
    if !valid_extension || !is_path_inside_library(path, library) {
        return false;
    }

    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() < 4 {
        return false;
    }

    let mut signature = [0_u8; 4];
    OpenOptions::new()
        .read(true)
        .open(path)
        .and_then(|mut file| file.read_exact(&mut signature))
        .is_ok()
        && matches!(
            signature,
            [0x50, 0x4b, 0x03, 0x04] | [0x50, 0x4b, 0x05, 0x06] | [0x50, 0x4b, 0x07, 0x08]
        )
}

pub fn validate_library_ipa(path: &Path) -> Result<bool, AppError> {
    Ok(ipa_file_is_available_in_library(path, &library_dir()?))
}

pub fn new_manifest_item(
    id: String,
    bundle_id: String,
    app_name: Option<String>,
    ipa_path: String,
    downloaded_at: String,
    source_device_name: Option<String>,
) -> ManifestItem {
    let lookup = validate_icon_cache(&bundle_id);
    ManifestItem {
        id,
        bundle_id,
        app_name,
        ipa_path,
        downloaded_at,
        source_device_name,
        icon_path: lookup
            .as_ref()
            .ok()
            .filter(|lookup| lookup.valid)
            .map(|lookup| lookup.path.to_string_lossy().to_string()),
        icon_updated_at: lookup
            .as_ref()
            .ok()
            .filter(|lookup| lookup.valid)
            .and_then(|lookup| lookup.updated_at.clone()),
        icon_cache_version: lookup
            .as_ref()
            .ok()
            .filter(|lookup| lookup.valid)
            .map(|_| ICON_CACHE_VERSION),
        status: ManifestItemStatus::Downloaded,
    }
}

pub fn cached_icon_path(bundle_id: &str) -> Result<PathBuf, AppError> {
    Ok(icons_dir()?.join(format!("{}.png", sanitize_file_component(bundle_id))))
}

pub fn cached_icon_metadata(bundle_id: &str) -> (Option<String>, Option<String>, Option<u32>) {
    match validate_icon_cache(bundle_id) {
        Ok(lookup) if lookup.valid => (
            Some(lookup.path.to_string_lossy().to_string()),
            lookup.updated_at,
            Some(ICON_CACHE_VERSION),
        ),
        Ok(_) => (None, None, None),
        Err(_) => (None, None, None),
    }
}

pub fn validate_icon_cache(bundle_id: &str) -> Result<IconCacheLookup, AppError> {
    let path = cached_icon_path(bundle_id)?;
    let metadata_path = icon_metadata_path(bundle_id)?;
    let path_metadata = fs::symlink_metadata(&path).ok();
    let exists = path_metadata.is_some();
    let metadata = read_icon_metadata(&metadata_path).ok();
    let metadata_version = metadata
        .as_ref()
        .map(|metadata| metadata.icon_cache_version);

    if !exists {
        return Ok(IconCacheLookup {
            path,
            metadata_path,
            exists,
            metadata_version,
            valid: false,
            validation_result: "missing file".to_string(),
            file_size: None,
            width: None,
            height: None,
            sha256: None,
            updated_at: metadata.map(|metadata| metadata.updated_at),
        });
    }

    if path_metadata.is_some_and(|metadata| !metadata.file_type().is_file()) {
        return Ok(invalid_lookup(
            path,
            metadata_path,
            true,
            metadata_version,
            "icon cache path is not a regular file",
        ));
    }

    let Some(metadata) = metadata else {
        return Ok(invalid_lookup(
            path,
            metadata_path,
            exists,
            None,
            "missing icon metadata",
        ));
    };

    if metadata.icon_cache_version != ICON_CACHE_VERSION {
        return Ok(invalid_lookup(
            path,
            metadata_path,
            exists,
            Some(metadata.icon_cache_version),
            "old icon cache version",
        ));
    }

    match inspect_png(&path) {
        Ok(inspection) => {
            let metadata_matches = metadata.file_size == inspection.file_size
                && metadata.width == inspection.width
                && metadata.height == inspection.height
                && metadata.sha256 == inspection.sha256;
            Ok(IconCacheLookup {
                path,
                metadata_path,
                exists,
                metadata_version: Some(metadata.icon_cache_version),
                valid: metadata_matches,
                validation_result: if metadata_matches {
                    "valid".to_string()
                } else {
                    "metadata mismatch".to_string()
                },
                file_size: Some(inspection.file_size),
                width: Some(inspection.width),
                height: Some(inspection.height),
                sha256: Some(inspection.sha256),
                updated_at: Some(metadata.updated_at),
            })
        }
        Err(reason) => Ok(invalid_lookup_with_metadata(
            path,
            metadata_path,
            exists,
            Some(metadata.icon_cache_version),
            reason,
        )),
    }
}

pub fn write_icon_cache_metadata(bundle_id: &str) -> Result<IconCacheLookup, AppError> {
    let path = cached_icon_path(bundle_id)?;
    let metadata_path = icon_metadata_path(bundle_id)?;
    let inspection = inspect_png(&path).map_err(AppError::storage)?;
    let updated_at = Utc::now().to_rfc3339();
    let metadata = IconCacheMetadata {
        icon_cache_version: ICON_CACHE_VERSION,
        bundle_id: bundle_id.to_string(),
        updated_at: updated_at.clone(),
        file_size: inspection.file_size,
        width: inspection.width,
        height: inspection.height,
        sha256: inspection.sha256.clone(),
    };
    let raw = serde_json::to_string_pretty(&metadata)
        .map_err(|err| AppError::storage(format!("Failed to encode icon metadata: {err}")))?;
    atomic_write_private(&metadata_path, raw.as_bytes())?;
    Ok(IconCacheLookup {
        path,
        metadata_path,
        exists: true,
        metadata_version: Some(ICON_CACHE_VERSION),
        valid: true,
        validation_result: "valid".to_string(),
        file_size: Some(inspection.file_size),
        width: Some(inspection.width),
        height: Some(inspection.height),
        sha256: Some(inspection.sha256),
        updated_at: Some(updated_at),
    })
}

pub fn invalidate_icon_cache(bundle_id: &str) -> Result<(), AppError> {
    let path = cached_icon_path(bundle_id)?;
    let metadata_path = icon_metadata_path(bundle_id)?;
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(metadata_path);
    Ok(())
}

pub fn icon_validation_details(bundle_id: &str, lookup: &IconCacheLookup) -> String {
    format!(
        "bundleId: {bundle_id}\ncacheFile: {}\nmetadataFile: {}\nexists: {}\nfileSize: {}\ndimensions: {}x{}\niconCacheVersion: {}\nsha256: {}\nvalidation: {}",
        lookup
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unavailable"),
        lookup
            .metadata_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unavailable"),
        lookup.exists,
        lookup
            .file_size
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        lookup
            .width
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        lookup
            .height
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        lookup
            .metadata_version
            .map(|value| value.to_string())
            .unwrap_or_else(|| "none".to_string()),
        lookup.sha256.as_deref().unwrap_or("unknown"),
        lookup.validation_result,
    )
}

fn icon_metadata_path(bundle_id: &str) -> Result<PathBuf, AppError> {
    Ok(icons_dir()?.join(format!("{}.json", sanitize_file_component(bundle_id))))
}

fn read_icon_metadata(path: &Path) -> Result<IconCacheMetadata, AppError> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(AppError::storage("Icon metadata is not a regular file"));
    }
    let raw = fs::read_to_string(path)
        .map_err(|err| AppError::storage(format!("Failed to read {}: {err}", path.display())))?;
    serde_json::from_str(&raw)
        .map_err(|err| AppError::storage(format!("Failed to parse {}: {err}", path.display())))
}

#[derive(Debug)]
struct PngInspection {
    file_size: u64,
    width: u32,
    height: u32,
    sha256: String,
}

fn inspect_png(path: &Path) -> Result<PngInspection, String> {
    let metadata = fs::metadata(path).map_err(|err| format!("metadata failed: {err}"))?;
    if !metadata.is_file() {
        return Err("not a file".to_string());
    }
    if metadata.len() <= MIN_ICON_FILE_SIZE {
        return Err(format!("file too small: {} bytes", metadata.len()));
    }

    let bytes = fs::read(path).map_err(|err| format!("read failed: {err}"))?;
    let decoder = png::Decoder::new(Cursor::new(&bytes));
    let mut reader = decoder
        .read_info()
        .map_err(|err| format!("png decode failed: {err}"))?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let frame = reader
        .next_frame(&mut buffer)
        .map_err(|err| format!("png frame decode failed: {err}"))?;
    if frame.width < MIN_ICON_DIMENSION || frame.height < MIN_ICON_DIMENSION {
        return Err(format!(
            "dimensions too small: {}x{}",
            frame.width, frame.height
        ));
    }

    let sha256 = format!("{:x}", Sha256::digest(&bytes));

    Ok(PngInspection {
        file_size: metadata.len(),
        width: frame.width,
        height: frame.height,
        sha256,
    })
}

fn invalid_lookup(
    path: PathBuf,
    metadata_path: PathBuf,
    exists: bool,
    metadata_version: Option<u32>,
    reason: &str,
) -> IconCacheLookup {
    invalid_lookup_with_metadata(
        path,
        metadata_path,
        exists,
        metadata_version,
        reason.to_string(),
    )
}

fn invalid_lookup_with_metadata(
    path: PathBuf,
    metadata_path: PathBuf,
    exists: bool,
    metadata_version: Option<u32>,
    reason: String,
) -> IconCacheLookup {
    IconCacheLookup {
        path,
        metadata_path,
        exists,
        metadata_version,
        valid: false,
        validation_result: reason,
        file_size: None,
        width: None,
        height: None,
        sha256: None,
        updated_at: None,
    }
}

fn is_deletable_library_ipa(path: &Path, library: &Path) -> bool {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ipa"))
    {
        return false;
    }

    is_path_inside_library(path, library)
}

fn is_path_inside_library(path: &Path, library: &Path) -> bool {
    match (fs::canonicalize(path), fs::canonicalize(library)) {
        (Ok(path), Ok(library)) => path.starts_with(library),
        _ => false,
    }
}

pub fn ensure_private_dir(path: &Path) -> Result<(), AppError> {
    fs::create_dir_all(path)
        .map_err(|err| AppError::storage(format!("Failed to create {}: {err}", path.display())))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|err| AppError::storage(format!("Failed to secure {}: {err}", path.display())))
}

pub fn atomic_write_private(path: &Path, contents: &[u8]) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::storage("Storage path has no parent directory"))?;
    ensure_private_dir(parent)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::storage("Storage path has no valid file name"))?;
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));

    let write_result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temp_path)
            .map_err(|err| AppError::storage(format!("Failed to create temporary file: {err}")))?;
        file.write_all(contents)
            .and_then(|()| file.sync_all())
            .map_err(|err| AppError::storage(format!("Failed to write temporary file: {err}")))?;
        fs::rename(&temp_path, path)
            .map_err(|err| AppError::storage(format!("Failed to replace storage file: {err}")))?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|err| AppError::storage(format!("Failed to secure storage file: {err}")))
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn sanitize_file_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn lock_manifest() -> Result<MutexGuard<'static, ()>, AppError> {
    MANIFEST_LOCK
        .lock()
        .map_err(|_| AppError::storage("Manifest lock poisoned"))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use tempfile::tempdir;

    use super::*;
    use crate::models::{ManifestItem, ManifestItemStatus};

    #[test]
    fn sanitizes_bundle_id_for_icon_cache_paths() {
        assert_eq!(
            sanitize_file_component("com.example/App:Name"),
            "com.example_App_Name"
        );
    }

    #[test]
    fn rejects_tiny_png_as_invalid_icon_cache() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("tiny.png");
        fs::write(&path, b"\x89PNG\r\n\x1a\n").expect("write tiny png");

        let error = inspect_png(&path).expect_err("tiny png should fail validation");

        assert!(error.contains("file too small"));
    }

    #[test]
    fn accepts_decodable_png_with_reasonable_dimensions() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("icon.png");
        write_test_png(&path);

        let inspection = inspect_png(&path).expect("valid test png should pass");

        assert_eq!(inspection.width, 64);
        assert_eq!(inspection.height, 64);
        assert!(inspection.file_size > MIN_ICON_FILE_SIZE);
    }

    #[test]
    fn maps_manifest_item_to_downloaded_or_missing_local_ipa() {
        let dir = tempdir().expect("tempdir");
        let ipa_path = dir.path().join("Example.ipa");
        fs::write(&ipa_path, b"PK\x03\x04ipa").expect("write ipa");

        let downloaded = manifest_item_to_local_ipa_in(test_manifest_item(&ipa_path), dir.path());
        assert_eq!(downloaded.status, LocalIpaStatus::Downloaded);

        fs::remove_file(&ipa_path).expect("remove ipa");
        let missing = manifest_item_to_local_ipa_in(test_manifest_item(&ipa_path), dir.path());
        assert_eq!(missing.status, LocalIpaStatus::Missing);
    }

    #[test]
    fn rejects_empty_files_and_directories_during_library_reconcile() {
        let dir = tempdir().expect("tempdir");
        let empty_path = dir.path().join("Empty.ipa");
        fs::write(&empty_path, b"").expect("write empty ipa");
        let directory_path = dir.path().join("Directory.ipa");
        fs::create_dir(&directory_path).expect("create ipa directory");

        assert!(!ipa_file_is_available_in_library(&empty_path, dir.path()));
        assert!(!ipa_file_is_available_in_library(
            &directory_path,
            dir.path()
        ));
        assert!(!ipa_file_is_available_in_library(
            &dir.path().join("Missing.ipa"),
            dir.path()
        ));
    }

    #[test]
    fn only_deletes_ipa_files_inside_library_dir() {
        let dir = tempdir().expect("tempdir");
        let library = dir.path().join("Library");
        fs::create_dir_all(&library).expect("library dir");
        let ipa = library.join("Example.ipa");
        let txt = library.join("Example.txt");
        fs::write(&ipa, b"PK\x03\x04ipa").expect("write ipa");
        fs::write(&txt, b"text").expect("write txt");

        assert!(is_deletable_library_ipa(&ipa, &library));
        assert!(!is_deletable_library_ipa(&txt, &library));
    }

    #[test]
    fn removes_missing_ipa_entries_from_manifest_without_file_delete() {
        let dir = tempdir().expect("tempdir");
        let library = dir.path().join("Library");
        fs::create_dir_all(&library).expect("library dir");
        let missing_path = library.join("Missing.ipa");
        let downloaded_path = library.join("Downloaded.ipa");
        fs::write(&downloaded_path, b"PK\x03\x04ipa").expect("write ipa");
        let manifest = Manifest {
            items: vec![
                ManifestItem {
                    id: "missing".to_string(),
                    ..test_manifest_item(&missing_path)
                },
                ManifestItem {
                    id: "downloaded".to_string(),
                    ..test_manifest_item(&downloaded_path)
                },
            ],
        };
        let ids = HashSet::from(["missing".to_string()]);

        let (updated, removed) =
            remove_local_ipa_items(manifest, &ids, &library).expect("remove missing manifest item");

        assert_eq!(removed, 1);
        assert_eq!(updated.items.len(), 1);
        assert_eq!(updated.items[0].id, "downloaded");
        assert!(downloaded_path.exists());
    }

    #[test]
    fn rejects_ipa_outside_library_and_non_zip_content() {
        let dir = tempdir().expect("tempdir");
        let library = dir.path().join("Library");
        fs::create_dir_all(&library).expect("library dir");
        let outside = dir.path().join("Outside.ipa");
        let invalid = library.join("Invalid.ipa");
        fs::write(&outside, b"PK\x03\x04ipa").expect("write outside ipa");
        fs::write(&invalid, b"not a zip").expect("write invalid ipa");

        assert!(!ipa_file_is_available_in_library(&outside, &library));
        assert!(!ipa_file_is_available_in_library(&invalid, &library));
    }

    #[test]
    fn atomic_private_write_replaces_content_with_private_permissions() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("manifest.json");

        atomic_write_private(&path, b"first").expect("first write");
        atomic_write_private(&path, b"second").expect("replacement write");

        assert_eq!(fs::read(&path).expect("read file"), b"second");
        assert_eq!(
            fs::metadata(&path).expect("metadata").permissions().mode() & 0o777,
            0o600
        );
        assert!(
            fs::read_dir(dir.path())
                .expect("read directory")
                .all(|entry| !entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp"))
        );
    }

    fn test_manifest_item(path: &Path) -> ManifestItem {
        ManifestItem {
            id: "id".to_string(),
            bundle_id: "com.example.app".to_string(),
            app_name: Some("Example".to_string()),
            ipa_path: path.to_string_lossy().to_string(),
            downloaded_at: "2026-07-09T00:00:00Z".to_string(),
            source_device_name: Some("Source".to_string()),
            icon_path: None,
            icon_updated_at: None,
            icon_cache_version: None,
            status: ManifestItemStatus::Downloaded,
        }
    }

    fn write_test_png(path: &Path) {
        let file = fs::File::create(path).expect("create png");
        let mut encoder = png::Encoder::new(file, 64, 64);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("png header");
        let mut data = Vec::with_capacity(64 * 64 * 4);
        for y in 0..64u8 {
            for x in 0..64u8 {
                data.push(x.wrapping_mul(3));
                data.push(y.wrapping_mul(5));
                data.push(x ^ y);
                data.push(255);
            }
        }
        writer.write_image_data(&data).expect("png data");
    }
}
