//! Navigation: OSRM routing, geocoding, and downloadable region packs.

pub mod geocoder;
pub mod osrm;
pub mod router;

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

pub use geocoder::SearchResult;
pub use osrm::OsrmManager;
pub use router::RouteData;

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const MAX_ARCHIVE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 256;
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";
const REQUIRED_PACK_FILES: &[&str] = &[
    "region.osrm",
    "region.osrm.cells",
    "region.osrm.cell_metrics",
    "region.osrm.datasource_names",
    "region.osrm.ebg",
    "region.osrm.ebg_nodes",
    "region.osrm.edges",
    "region.osrm.enw",
    "region.osrm.fileIndex",
    "region.osrm.geometry",
    "region.osrm.icd",
    "region.osrm.maneuver_overrides",
    "region.osrm.mldgr",
    "region.osrm.names",
    "region.osrm.nbg_nodes",
    "region.osrm.partition",
    "region.osrm.properties",
    "region.osrm.ramIndex",
    "region.osrm.restrictions",
    "region.osrm.timestamp",
    "region.osrm.tld",
    "region.osrm.tls",
    "region.osrm.turn_duration_penalties",
    "region.osrm.turn_penalties",
    "places.db",
];
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

// --- paths ---

fn nav_root(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("nav"))
}
fn region_dir(app: &AppHandle, id: &str) -> Option<PathBuf> {
    nav_root(app).map(|r| r.join(id))
}
fn osrm_file(app: &AppHandle, id: &str) -> Option<PathBuf> {
    region_dir(app, id).map(|d| d.join("region.osrm"))
}
fn is_installed(app: &AppHandle, id: &str) -> bool {
    region_dir(app, id)
        .map(|path| validate_pack(&path).is_ok())
        .unwrap_or(false)
}

/// The places.db of the first installed region (used by geocoding).
fn installed_places_db(app: &AppHandle) -> PathBuf {
    for r in load_manifest(app) {
        if is_installed(app, &r.id) {
            if let Some(dir) = region_dir(app, &r.id) {
                return dir.join("places.db");
            }
        }
    }
    PathBuf::from("/nonexistent/places.db")
}

fn first_installed_region(app: &AppHandle) -> Option<String> {
    load_manifest(app)
        .into_iter()
        .map(|r| r.id)
        .find(|id| is_installed(app, id))
}

// --- region manifest (resources/map/regions.json) ---

#[derive(Deserialize)]
struct ManifestFile {
    regions: Vec<ManifestRegion>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ManifestRegion {
    id: String,
    name: String,
    #[serde(default)]
    nav_pack_url: Option<String>,
    #[serde(default)]
    nav_pack_sha256: Option<String>,
    #[serde(default)]
    nav_pack_size_bytes: Option<u64>,
}

fn load_manifest(app: &AppHandle) -> Vec<ManifestRegion> {
    let Ok(res) = app.path().resource_dir() else {
        return Vec::new();
    };
    let path = res.join("map/regions.json");
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<ManifestFile>(&text)
        .map(|m| m.regions)
        .unwrap_or_default()
}

// --- DTOs ---

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NavStatus {
    pub router_running: bool,
    pub installed_region: Option<String>,
    pub router_error: Option<String>,
    pub port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavRegion {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub size_mb: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    region_id: String,
    step: String, // "download" | "extract" | "done" | "error"
    percent: u8,
}

// --- commands ---

#[tauri::command]
pub fn nav_status(app: AppHandle, osrm: State<'_, OsrmManager>) -> NavStatus {
    NavStatus {
        router_running: osrm.is_running(),
        installed_region: osrm.region().or_else(|| first_installed_region(&app)),
        router_error: osrm.failure(),
        port: osrm.port,
    }
}

#[tauri::command]
pub async fn calculate_route(
    app: AppHandle,
    osrm: State<'_, OsrmManager>,
    from_lon: f64,
    from_lat: f64,
    to_lon: f64,
    to_lat: f64,
    heading: Option<f64>,
    speed: Option<f64>,
) -> Result<RouteData, String> {
    let region_id = first_installed_region(&app)
        .ok_or("Install a navigation region before calculating a route.")?;
    let graph = osrm_file(&app, &region_id).ok_or("no app data dir")?;
    let lease = osrm.start(&app, &region_id, &graph).await?;
    let port = osrm.port;
    let route =
        router::calculate_route(from_lon, from_lat, to_lon, to_lat, heading, speed, port).await;
    drop(lease);
    osrm.note_activity(&app).await;
    route
}

#[tauri::command]
pub async fn nav_note_activity(app: AppHandle, osrm: State<'_, OsrmManager>) -> Result<(), String> {
    osrm.note_activity(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn geocode_search(
    app: AppHandle,
    query: String,
    near_lat: Option<f64>,
    near_lon: Option<f64>,
) -> Result<Vec<SearchResult>, String> {
    let db = installed_places_db(&app);
    let near = match (near_lat, near_lon) {
        (Some(a), Some(o)) => Some((a, o)),
        _ => None,
    };
    Ok(geocoder::search(&db, &query, near, 10).await)
}

#[tauri::command]
pub fn nav_list_regions(app: AppHandle) -> Vec<NavRegion> {
    load_manifest(&app)
        .into_iter()
        .map(|r| {
            let installed = is_installed(&app, &r.id);
            let size_mb = region_dir(&app, &r.id)
                .filter(|_| installed)
                .map(|d| dir_size(&d) / 1024 / 1024)
                .unwrap_or(0);
            NavRegion {
                id: r.id,
                name: r.name,
                installed,
                size_mb,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn nav_download_region(
    app: AppHandle,
    osrm: State<'_, OsrmManager>,
    region_id: String,
) -> Result<(), String> {
    let region = load_manifest(&app)
        .into_iter()
        .find(|r| r.id == region_id)
        .ok_or("unknown region")?;
    let url = region
        .nav_pack_url
        .filter(|u| !u.is_empty())
        .ok_or("region has no navPackUrl (host a pack or sideload it)")?;
    let dir = region_dir(&app, &region_id).ok_or("no app data dir")?;
    let root = nav_root(&app).ok_or("no app data dir")?;
    let expected_sha256 = normalize_sha256(region.nav_pack_sha256.as_deref())?;
    if region
        .nav_pack_size_bytes
        .is_some_and(|size| size > MAX_ARCHIVE_BYTES)
    {
        return Err(format!(
            "navigation pack exceeds the {} byte archive limit",
            MAX_ARCHIVE_BYTES
        ));
    }

    let emit = |step: &str, percent: u8| {
        let _ = app.emit(
            "nav:download-progress",
            DownloadProgress {
                region_id: region_id.clone(),
                step: step.to_string(),
                percent,
            },
        );
    };

    let result = osrm
        .install_region(&region_id, &dir, || async {
            let staging = StagingDirectory::create(&root)?;
            let zip_path = staging.path().join("pack.zip");
            let content_dir = staging.path().join("content");
            fs::create_dir(&content_dir).map_err(|e| e.to_string())?;

            emit("download", 0);
            let client = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(30))
                .build()
                .map_err(|e| e.to_string())?;
            let mut response = client
                .get(&url)
                .timeout(DOWNLOAD_TIMEOUT)
                .send()
                .await
                .map_err(|e| format!("navigation pack download failed: {e}"))?
                .error_for_status()
                .map_err(|e| format!("navigation pack download failed: {e}"))?;
            let content_length = response.content_length();
            if content_length.is_some_and(|size| size > MAX_ARCHIVE_BYTES) {
                return Err(format!(
                    "navigation pack exceeds the {} byte archive limit",
                    MAX_ARCHIVE_BYTES
                ));
            }
            if let (Some(actual), Some(expected)) = (content_length, region.nav_pack_size_bytes) {
                if actual != expected {
                    return Err(format!(
                        "navigation pack Content-Length mismatch: expected {expected}, got {actual}"
                    ));
                }
            }

            let mut output = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
            let mut hasher = Sha256::new();
            let mut downloaded = 0u64;
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|e| format!("navigation pack download failed: {e}"))?
            {
                downloaded = downloaded
                    .checked_add(chunk.len() as u64)
                    .ok_or("navigation pack size overflow")?;
                if downloaded > MAX_ARCHIVE_BYTES {
                    return Err(format!(
                        "navigation pack exceeds the {} byte archive limit",
                        MAX_ARCHIVE_BYTES
                    ));
                }
                hasher.update(&chunk);
                output.write_all(&chunk).map_err(|e| e.to_string())?;
                if let Some(total) = content_length.filter(|total| *total > 0) {
                    emit(
                        "download",
                        ((downloaded.min(total) as f64 / total as f64) * 100.0) as u8,
                    );
                }
            }
            output.flush().map_err(|e| e.to_string())?;
            drop(output);

            if let Some(expected) = region.nav_pack_size_bytes {
                if downloaded != expected {
                    return Err(format!(
                        "navigation pack size mismatch: expected {expected}, got {downloaded}"
                    ));
                }
            }
            if let Some(expected) = expected_sha256.as_deref() {
                let actual = format!("{:x}", hasher.finalize());
                if actual != expected {
                    return Err(format!(
                        "navigation pack SHA-256 mismatch: expected {expected}, got {actual}"
                    ));
                }
            }

            emit("extract", 0);
            extract_pack(&zip_path, &content_dir, PackLimits::production())?;
            validate_pack(&content_dir)?;
            Ok(staging.prepare(content_dir))
        })
        .await;

    match result {
        Ok(()) => {
            emit("done", 100);
            let _ = app.emit("nav:status", nav_status(app.clone(), osrm));
            Ok(())
        }
        Err(error) => {
            emit("error", 0);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn nav_delete_region(
    app: AppHandle,
    osrm: State<'_, OsrmManager>,
    region_id: String,
) -> Result<(), String> {
    // Validate against the manifest before any filesystem work — `region_dir`
    // joins this onto the nav root, so an unvalidated `..`-laden id would let
    // `remove_dir_all` escape the nav root (mirrors `nav_download_region`).
    load_manifest(&app)
        .into_iter()
        .find(|r| r.id == region_id)
        .ok_or("unknown region")?;
    if let Some(dir) = region_dir(&app, &region_id) {
        osrm.stop_and_delete_region(&region_id, &dir).await?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct PackLimits {
    archive_entries: usize,
    extracted_bytes: u64,
}

impl PackLimits {
    const fn production() -> Self {
        Self {
            archive_entries: MAX_ARCHIVE_ENTRIES,
            extracted_bytes: MAX_EXTRACTED_BYTES,
        }
    }
}

struct StagingDirectory {
    path: PathBuf,
    preserve: bool,
}

impl StagingDirectory {
    fn create(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        for _ in 0..100 {
            let sequence = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = root.join(format!(
                ".nav-pack-staging-{}-{nanos}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => {
                    return Ok(Self {
                        path,
                        preserve: false,
                    })
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.to_string()),
            }
        }
        Err("could not allocate a unique navigation staging directory".to_string())
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn prepare(mut self, content_dir: PathBuf) -> osrm::PreparedInstall {
        self.preserve = true;
        osrm::PreparedInstall {
            content_dir,
            staging_root: self.path.clone(),
        }
    }
}

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        if !self.preserve {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

fn normalize_sha256(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("navPackSha256 must contain exactly 64 hexadecimal characters".to_string());
    }
    Ok(Some(value.to_ascii_lowercase()))
}

fn safe_archive_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.contains('\0')
        || name.contains('\\')
        || name.starts_with('/')
        || name.as_bytes().get(1) == Some(&b':')
    {
        return Err(format!("unsafe navigation pack path: {name:?}"));
    }
    let mut path = PathBuf::new();
    for component in Path::new(name).components() {
        match component {
            std::path::Component::Normal(component) => path.push(component),
            _ => return Err(format!("unsafe navigation pack path: {name:?}")),
        }
    }
    if path.as_os_str().is_empty() {
        return Err(format!("unsafe navigation pack path: {name:?}"));
    }
    Ok(path)
}

fn extract_pack(zip_path: &Path, destination: &Path, limits: PackLimits) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    if archive.len() > limits.archive_entries {
        return Err(format!(
            "navigation pack has {} entries; limit is {}",
            archive.len(),
            limits.archive_entries
        ));
    }

    let mut declared_size = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|e| e.to_string())?;
        safe_archive_path(entry.name())?;
        reject_special_zip_entry(&entry)?;
        declared_size = declared_size
            .checked_add(entry.size())
            .ok_or("navigation pack extracted size overflow")?;
        if declared_size > limits.extracted_bytes {
            return Err(format!(
                "navigation pack exceeds the {} byte extracted-size limit",
                limits.extracted_bytes
            ));
        }
    }

    let mut extracted_size = 0u64;
    let mut paths = std::collections::HashSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let relative = safe_archive_path(entry.name())?;
        reject_special_zip_entry(&entry)?;
        if !paths.insert(relative.clone()) {
            return Err(format!(
                "navigation pack contains duplicate path {}",
                relative.display()
            ));
        }
        let output_path = destination.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output_path)
            .map_err(|e| e.to_string())?;
        let remaining = limits.extracted_bytes.saturating_sub(extracted_size);
        let copied = std::io::copy(&mut entry.take(remaining.saturating_add(1)), &mut output)
            .map_err(|e| e.to_string())?;
        if copied > remaining {
            return Err(format!(
                "navigation pack exceeds the {} byte extracted-size limit",
                limits.extracted_bytes
            ));
        }
        extracted_size += copied;
    }
    Ok(())
}

fn reject_special_zip_entry(entry: &zip::read::ZipFile<'_>) -> Result<(), String> {
    if let Some(mode) = entry.unix_mode() {
        let file_type = mode & 0o170000;
        if file_type != 0 && file_type != 0o040000 && file_type != 0o100000 {
            return Err(format!(
                "navigation pack entry is not a regular file or directory: {:?}",
                entry.name()
            ));
        }
    }
    Ok(())
}

fn validate_pack(directory: &Path) -> Result<(), String> {
    for name in REQUIRED_PACK_FILES {
        let path = directory.join(name);
        let metadata = path
            .symlink_metadata()
            .map_err(|_| format!("navigation pack is missing required file {name}"))?;
        if !metadata.file_type().is_file() || metadata.len() == 0 {
            return Err(format!(
                "navigation pack required file {name} is not a non-empty regular file"
            ));
        }
    }

    let mut header = [0u8; SQLITE_HEADER.len()];
    fs::File::open(directory.join("places.db"))
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|e| format!("could not read places.db header: {e}"))?;
    if &header != SQLITE_HEADER {
        return Err("navigation pack places.db is not a SQLite database".to_string());
    }
    let connection = rusqlite::Connection::open_with_flags(
        directory.join("places.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("could not open places.db: {e}"))?;
    connection
        .prepare(
            "SELECT p.name, p.category, p.latitude, p.longitude, p.importance
             FROM places_fts JOIN places p ON places_fts.rowid = p.rowid LIMIT 0",
        )
        .map_err(|e| format!("places.db does not have the required geocoder schema: {e}"))?;
    Ok(())
}

fn replacement_backup_path(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or("navigation region has no parent directory")?;
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("navigation region has an invalid directory name")?;
    for _ in 0..100 {
        let sequence = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{name}.backup-{}-{sequence}", std::process::id()));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("could not allocate a navigation pack backup path".to_string())
}

fn replace_directory_atomically(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err("prepared navigation pack directory is missing".to_string());
    }
    let parent = target
        .parent()
        .ok_or("navigation region has no parent directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if !target.exists() {
        return fs::rename(source, target).map_err(|e| e.to_string());
    }

    let backup = replacement_backup_path(target)?;
    fs::rename(target, &backup)
        .map_err(|e| format!("failed to preserve existing navigation pack: {e}"))?;
    if let Err(error) = fs::rename(source, target) {
        let rollback = fs::rename(&backup, target);
        return match rollback {
            Ok(()) => Err(format!("failed to install navigation pack: {error}")),
            Err(rollback_error) => Err(format!(
                "failed to install navigation pack ({error}) and restore the previous pack ({rollback_error})"
            )),
        };
    }
    fs::remove_dir_all(&backup)
        .map_err(|e| format!("installed navigation pack but could not remove old pack: {e}"))
}

fn dir_size(p: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(rd) = fs::read_dir(p) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(m) = path.metadata() {
                    total += m.len();
                }
            } else if path.is_dir() {
                total += dir_size(&path);
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn create() -> Self {
            let root = std::env::temp_dir().join(format!(
                "speeddeck-nav-test-{}-{}",
                std::process::id(),
                STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_valid_pack(directory: &Path) {
        fs::create_dir_all(directory).unwrap();
        for name in REQUIRED_PACK_FILES {
            if *name != "places.db" {
                fs::write(directory.join(name), b"graph").unwrap();
            }
        }
        let connection = rusqlite::Connection::open(directory.join("places.db")).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE places (
                    name TEXT, category TEXT, latitude REAL, longitude REAL, importance INTEGER
                 );
                 CREATE TABLE places_fts (name TEXT);",
            )
            .unwrap();
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (name, contents) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn staging_directories_are_unique_and_cleaned_up() {
        let root = TestDirectory::create();
        let first = StagingDirectory::create(&root.0).unwrap();
        let second = StagingDirectory::create(&root.0).unwrap();
        assert_ne!(first.path(), second.path());
        let first_path = first.path().to_path_buf();
        drop(first);
        assert!(!first_path.exists());
        assert!(second.path().is_dir());
    }

    #[test]
    fn extraction_rejects_parent_traversal() {
        let root = TestDirectory::create();
        let zip_path = root.0.join("bad.zip");
        write_zip(&zip_path, &[("../escape", b"bad")]);
        let destination = root.0.join("content");
        fs::create_dir(&destination).unwrap();
        let result = extract_pack(&zip_path, &destination, PackLimits::production());
        assert!(result.unwrap_err().contains("unsafe navigation pack path"));
        assert!(!root.0.join("escape").exists());
    }

    #[test]
    fn extraction_enforces_entry_and_size_caps() {
        let root = TestDirectory::create();
        let zip_path = root.0.join("limited.zip");
        write_zip(&zip_path, &[("one", b"1234"), ("two", b"5678")]);
        let destination = root.0.join("content");
        fs::create_dir(&destination).unwrap();
        assert!(extract_pack(
            &zip_path,
            &destination,
            PackLimits {
                archive_entries: 1,
                extracted_bytes: 100,
            },
        )
        .unwrap_err()
        .contains("entries"));

        let second_destination = root.0.join("content-2");
        fs::create_dir(&second_destination).unwrap();
        assert!(extract_pack(
            &zip_path,
            &second_destination,
            PackLimits {
                archive_entries: 10,
                extracted_bytes: 7,
            },
        )
        .unwrap_err()
        .contains("extracted-size"));
    }

    #[test]
    fn pack_validation_requires_graph_family_and_sqlite_database() {
        let root = TestDirectory::create();
        write_valid_pack(&root.0);
        validate_pack(&root.0).unwrap();

        fs::remove_file(root.0.join("region.osrm.partition")).unwrap();
        assert!(validate_pack(&root.0)
            .unwrap_err()
            .contains("region.osrm.partition"));
        fs::write(root.0.join("region.osrm.partition"), b"graph").unwrap();
        fs::write(root.0.join("places.db"), b"not sqlite data!").unwrap();
        assert!(validate_pack(&root.0).unwrap_err().contains("not a SQLite"));
    }

    #[test]
    fn replacement_swaps_complete_directories() {
        let root = TestDirectory::create();
        let target = root.0.join("region");
        let source = root.0.join("prepared");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("version"), b"old").unwrap();
        fs::create_dir(&source).unwrap();
        fs::write(source.join("version"), b"new").unwrap();

        replace_directory_atomically(&source, &target).unwrap();
        assert_eq!(fs::read(target.join("version")).unwrap(), b"new");
        assert!(!source.exists());
    }

    #[test]
    fn manifest_sha256_is_optional_but_strict_when_present() {
        assert_eq!(normalize_sha256(None).unwrap(), None);
        assert!(normalize_sha256(Some("abc")).is_err());
        let upper = "A".repeat(64);
        assert_eq!(
            normalize_sha256(Some(&upper)).unwrap(),
            Some("a".repeat(64))
        );
    }
}
