//! Library scanner: walk folders, read tags + cover art via `lofty`, upsert.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use lofty::file::TaggedFileExt;
use lofty::prelude::{Accessor, AudioFile, ItemKey};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::library::{LibraryStore, TrackMeta};

const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "wv", "aiff", "aif",
];

/// True if the path has a supported audio extension (pure; unit-tested).
pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryProgress {
    step: String, // "scan" | "done"
    scanned: usize,
    total: usize,
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk(&p, out);
            } else if is_audio_file(&p) {
                out.push(p);
            }
        }
    }
}

/// Full rescan of all configured folders. Emits `media:library` progress.
pub fn scan(app: &AppHandle, store: &LibraryStore, art_dir: &Path) -> Result<usize, String> {
    let _ = std::fs::create_dir_all(art_dir);
    let folders = store.folders()?;

    let mut files = Vec::new();
    for f in &folders {
        walk(Path::new(f), &mut files);
    }
    let total = files.len();
    let _ = app.emit("media:library", LibraryProgress { step: "scan".into(), scanned: 0, total });

    let mut metas = Vec::with_capacity(total);
    for (i, path) in files.iter().enumerate() {
        if let Some(meta) = read_meta(path, art_dir) {
            metas.push(meta);
        }
        if i % 50 == 0 {
            let _ = app.emit("media:library", LibraryProgress { step: "scan".into(), scanned: i, total });
        }
    }

    store.replace_tracks(&metas)?;
    let _ = app.emit("media:library", LibraryProgress { step: "done".into(), scanned: total, total });
    Ok(metas.len())
}

fn read_meta(path: &Path, art_dir: &Path) -> Option<TrackMeta> {
    let tagged = lofty::read_from_path(path).ok()?;
    let mut m = TrackMeta {
        path: path.to_string_lossy().to_string(),
        duration_ms: Some(tagged.properties().duration().as_millis() as i64),
        ..Default::default()
    };

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        m.title = tag.title().map(|s| s.to_string());
        m.artist = tag.artist().map(|s| s.to_string());
        m.album = tag.album().map(|s| s.to_string());
        m.album_artist = tag.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string());
        m.genre = tag.genre().map(|s| s.to_string());
        m.track_no = tag.track().map(|n| n as i64);
        m.disc_no = tag.disk().map(|n| n as i64);
        m.year = tag.year().map(|y| y as i64);

        if let Some(pic) = tag.pictures().first() {
            let data = pic.data();
            let ext = pic
                .mime_type()
                .map(|mt| if mt.as_str().contains("png") { "png" } else { "jpg" })
                .unwrap_or("jpg");
            let key = format!("{}.{ext}", hash_bytes(data));
            let file = art_dir.join(&key);
            if !file.exists() {
                let _ = std::fs::write(&file, data);
            }
            m.art_key = Some(key);
        }
    }

    if m.title.is_none() {
        m.title = path.file_stem().map(|s| s.to_string_lossy().to_string());
    }
    Some(m)
}

fn hash_bytes(data: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    data.hash(&mut h);
    format!("{:016x}", h.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_extension_detection() {
        assert!(is_audio_file(Path::new("/m/song.mp3")));
        assert!(is_audio_file(Path::new("/m/song.FLAC")));
        assert!(is_audio_file(Path::new("/m/a.opus")));
        assert!(!is_audio_file(Path::new("/m/cover.jpg")));
        assert!(!is_audio_file(Path::new("/m/readme")));
    }
}
