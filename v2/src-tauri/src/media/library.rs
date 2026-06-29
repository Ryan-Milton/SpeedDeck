//! Music library cache (SQLite) — modeled on `trips/database.rs`.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};
use serde::Serialize;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS folders (
    path TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS tracks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT NOT NULL UNIQUE,
    title        TEXT,
    artist       TEXT,
    album        TEXT,
    album_artist TEXT,
    track_no     INTEGER,
    disc_no      INTEGER,
    duration_ms  INTEGER,
    genre        TEXT,
    year         INTEGER,
    art_key      TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album, album_artist);

CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
    title, artist, album, content='tracks', content_rowid='id'
);
"#;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub id: i64,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_no: Option<i64>,
    pub disc_no: Option<i64>,
    pub duration_ms: Option<i64>,
    pub genre: Option<String>,
    pub year: Option<i64>,
    pub art_key: Option<String>,
}

/// Metadata for an insert (id assigned by the DB).
#[derive(Clone, Debug, Default)]
pub struct TrackMeta {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_no: Option<i64>,
    pub disc_no: Option<i64>,
    pub duration_ms: Option<i64>,
    pub genre: Option<String>,
    pub year: Option<i64>,
    pub art_key: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumInfo {
    pub album: String,
    pub artist: String,
    pub art_key: Option<String>,
    pub track_count: i64,
    pub year: Option<i64>,
}

#[derive(Clone)]
pub struct LibraryStore {
    conn: Arc<Mutex<Connection>>,
}

impl LibraryStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(LibraryStore { conn: Arc::new(Mutex::new(conn)) })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(LibraryStore { conn: Arc::new(Mutex::new(conn)) })
    }

    // --- folders ---

    pub fn add_folder(&self, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT OR IGNORE INTO folders(path) VALUES (?1)", params![path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_folder(&self, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM folders WHERE path=?1", params![path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn folders(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT path FROM folders ORDER BY path")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    // --- tracks ---

    /// Replace all tracks with a fresh set (called after a full rescan).
    pub fn replace_tracks(&self, tracks: &[TrackMeta]) -> Result<(), String> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM tracks", []).map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO tracks
                     (path,title,artist,album,album_artist,track_no,disc_no,duration_ms,genre,year,art_key)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                )
                .map_err(|e| e.to_string())?;
            for t in tracks {
                stmt.execute(params![
                    t.path, t.title, t.artist, t.album, t.album_artist,
                    t.track_no, t.disc_no, t.duration_ms, t.genre, t.year, t.art_key,
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.execute("INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild')", [])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn track(&self, id: i64) -> Result<Option<TrackInfo>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("{SELECT_TRACK} WHERE id=?1")).map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(params![id], map_track).map_err(|e| e.to_string())?;
        match rows.next() {
            Some(r) => Ok(Some(r.map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }

    /// Look up a track by its file path — stable across rescans (unlike the
    /// AUTOINCREMENT id, which `replace_tracks` reassigns). The playback queue
    /// keys on path so a rescan never orphans the currently-playing track.
    pub fn track_by_path(&self, path: &str) -> Result<Option<TrackInfo>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("{SELECT_TRACK} WHERE path=?1")).map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(params![path], map_track).map_err(|e| e.to_string())?;
        match rows.next() {
            Some(r) => Ok(Some(r.map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }

    pub fn all_tracks(&self) -> Result<Vec<TrackInfo>, String> {
        self.query_tracks(&format!("{SELECT_TRACK} ORDER BY artist, album, disc_no, track_no"), [])
    }

    pub fn tracks_by_album(&self, album: &str, artist: &str) -> Result<Vec<TrackInfo>, String> {
        self.query_tracks(
            &format!(
                "{SELECT_TRACK} WHERE album=?1 AND COALESCE(album_artist, artist)=?2 \
                 ORDER BY disc_no, track_no"
            ),
            params![album, artist],
        )
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<TrackInfo>, String> {
        let safe = query.trim().replace('"', "\"\"");
        if safe.is_empty() {
            return Ok(Vec::new());
        }
        let fts = format!("\"{safe}\"*");
        self.query_tracks(
            &format!(
                "SELECT t.id,t.path,t.title,t.artist,t.album,t.album_artist,t.track_no,\
                 t.disc_no,t.duration_ms,t.genre,t.year,t.art_key \
                 FROM tracks_fts JOIN tracks t ON tracks_fts.rowid=t.id \
                 WHERE tracks_fts MATCH ?1 LIMIT {limit}"
            ),
            params![fts],
        )
    }

    pub fn albums(&self) -> Result<Vec<AlbumInfo>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT album, COALESCE(album_artist, artist) AS aa, \
                 MAX(art_key), COUNT(*), MAX(year) \
                 FROM tracks WHERE album IS NOT NULL AND album <> '' \
                 GROUP BY album, aa ORDER BY aa, album",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(AlbumInfo {
                    album: r.get(0)?,
                    artist: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    art_key: r.get(2)?,
                    track_count: r.get(3)?,
                    year: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn artists(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT COALESCE(album_artist, artist) AS aa FROM tracks \
                 WHERE aa IS NOT NULL AND aa <> '' ORDER BY aa",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn track_count(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0)).unwrap_or(0)
    }

    fn query_tracks(
        &self,
        sql: &str,
        params: impl rusqlite::Params,
    ) -> Result<Vec<TrackInfo>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params, map_track).map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }
}

const SELECT_TRACK: &str =
    "SELECT id,path,title,artist,album,album_artist,track_no,disc_no,duration_ms,genre,year,art_key FROM tracks";

fn map_track(r: &rusqlite::Row<'_>) -> rusqlite::Result<TrackInfo> {
    Ok(TrackInfo {
        id: r.get(0)?,
        path: r.get(1)?,
        title: r.get(2)?,
        artist: r.get(3)?,
        album: r.get(4)?,
        album_artist: r.get(5)?,
        track_no: r.get(6)?,
        disc_no: r.get(7)?,
        duration_ms: r.get(8)?,
        genre: r.get(9)?,
        year: r.get(10)?,
        art_key: r.get(11)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(path: &str, artist: &str, album: &str, title: &str, track: i64) -> TrackMeta {
        TrackMeta {
            path: path.into(),
            title: Some(title.into()),
            artist: Some(artist.into()),
            album: Some(album.into()),
            album_artist: Some(artist.into()),
            track_no: Some(track),
            duration_ms: Some(180_000),
            art_key: Some("art1".into()),
            ..Default::default()
        }
    }

    #[test]
    fn folders_roundtrip() {
        let s = LibraryStore::open_in_memory().unwrap();
        s.add_folder("/home/u/Music").unwrap();
        s.add_folder("/home/u/Music").unwrap(); // idempotent
        s.add_folder("/sd/Music").unwrap();
        assert_eq!(s.folders().unwrap().len(), 2);
        s.remove_folder("/sd/Music").unwrap();
        assert_eq!(s.folders().unwrap(), vec!["/home/u/Music"]);
    }

    #[test]
    fn replace_albums_artists_and_tracks() {
        let s = LibraryStore::open_in_memory().unwrap();
        s.replace_tracks(&[
            meta("/m/a1.mp3", "Daft Punk", "Discovery", "One More Time", 1),
            meta("/m/a2.mp3", "Daft Punk", "Discovery", "Aerodynamic", 2),
            meta("/m/b1.mp3", "Air", "Moon Safari", "La Femme d'Argent", 1),
        ])
        .unwrap();
        assert_eq!(s.track_count(), 3);
        assert_eq!(s.albums().unwrap().len(), 2);
        assert_eq!(s.artists().unwrap().len(), 2);
        let disc = s.tracks_by_album("Discovery", "Daft Punk").unwrap();
        assert_eq!(disc.len(), 2);
        assert_eq!(disc[0].track_no, Some(1));
    }

    #[test]
    fn fts_search_matches_prefix() {
        let s = LibraryStore::open_in_memory().unwrap();
        s.replace_tracks(&[meta("/m/a1.mp3", "Daft Punk", "Discovery", "One More Time", 1)])
            .unwrap();
        assert_eq!(s.search("disco", 10).unwrap().len(), 1);
        assert_eq!(s.search("daft", 10).unwrap().len(), 1);
        assert_eq!(s.search("zzzz", 10).unwrap().len(), 0);
    }

    #[test]
    fn replace_clears_previous() {
        let s = LibraryStore::open_in_memory().unwrap();
        s.replace_tracks(&[meta("/m/a1.mp3", "A", "X", "t", 1)]).unwrap();
        s.replace_tracks(&[meta("/m/b1.mp3", "B", "Y", "u", 1)]).unwrap();
        assert_eq!(s.track_count(), 1);
        assert_eq!(s.all_tracks().unwrap()[0].artist.as_deref(), Some("B"));
    }

    #[test]
    fn track_by_path_survives_id_reassignment_on_rescan() {
        let s = LibraryStore::open_in_memory().unwrap();
        // Prepend a row so the second scan hands "/m/keep.mp3" a different id.
        s.replace_tracks(&[meta("/m/keep.mp3", "A", "X", "Keep", 1)]).unwrap();
        let id_before = s.track_by_path("/m/keep.mp3").unwrap().unwrap().id;

        // Rescan inserts another track first → AUTOINCREMENT gives "/m/keep.mp3" a fresh id.
        s.replace_tracks(&[
            meta("/m/new.mp3", "B", "Y", "New", 1),
            meta("/m/keep.mp3", "A", "X", "Keep", 1),
        ])
        .unwrap();

        let after = s.track_by_path("/m/keep.mp3").unwrap().expect("path still resolves");
        assert_eq!(after.title.as_deref(), Some("Keep"));
        // The id changed (proving the queue must not key on it), but path is stable.
        assert_ne!(after.id, id_before);
        // The stale id no longer resolves — exactly the bug the queue would hit.
        assert!(s.track(id_before).unwrap().is_none());
    }
}
