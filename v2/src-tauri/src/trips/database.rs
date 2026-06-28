//! SQLite trip storage — ported from v1 `trip/database.py` (identical schema).

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};
use serde::Serialize;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS trips (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    distance_m  REAL DEFAULT 0,
    max_speed   REAL DEFAULT 0,
    avg_speed   REAL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trackpoints (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    timestamp   TEXT NOT NULL,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    altitude    REAL,
    speed       REAL,
    heading     REAL,
    satellites  INTEGER,
    fix_quality INTEGER,
    hdop        REAL
);

CREATE INDEX IF NOT EXISTS idx_trackpoints_trip
    ON trackpoints(trip_id, timestamp);
"#;

/// One recorded trackpoint (mirrors the broadcast fix shape).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trackpoint {
    pub timestamp: String,
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: Option<f64>,
    pub speed: Option<f64>,
    pub heading: Option<f64>,
    pub satellites: Option<i64>,
    pub fix_quality: Option<i64>,
    pub hdop: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TripInfo {
    pub id: i64,
    pub name: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub distance_m: f64,
    pub max_speed: f64,
    pub avg_speed: f64,
}

/// Thread-safe handle to the trip database (cloneable; shares one connection).
#[derive(Clone)]
pub struct TripStore {
    conn: Arc<Mutex<Connection>>,
}

impl TripStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(TripStore {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// In-memory store for tests.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(TripStore {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn create_trip(&self, name: Option<&str>, started_at: &str) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO trips (name, started_at) VALUES (?1, ?2)",
            params![name, started_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn end_trip(
        &self,
        trip_id: i64,
        ended_at: &str,
        distance_m: f64,
        max_speed: f64,
        avg_speed: f64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE trips SET ended_at=?1, distance_m=?2, max_speed=?3, avg_speed=?4 WHERE id=?5",
            params![ended_at, distance_m, max_speed, avg_speed, trip_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn insert_trackpoints(&self, trip_id: i64, points: &[Trackpoint]) -> Result<(), String> {
        if points.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO trackpoints
                     (trip_id, timestamp, latitude, longitude, altitude, speed, heading,
                      satellites, fix_quality, hdop)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                )
                .map_err(|e| e.to_string())?;
            for p in points {
                stmt.execute(params![
                    trip_id,
                    p.timestamp,
                    p.latitude,
                    p.longitude,
                    p.altitude,
                    p.speed,
                    p.heading,
                    p.satellites,
                    p.fix_quality,
                    p.hdop,
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_trips(&self) -> Result<Vec<TripInfo>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, started_at, ended_at, distance_m, max_speed, avg_speed
                 FROM trips ORDER BY started_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(TripInfo {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    started_at: r.get(2)?,
                    ended_at: r.get(3)?,
                    distance_m: r.get(4)?,
                    max_speed: r.get(5)?,
                    avg_speed: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_trip(&self, trip_id: i64) -> Result<Option<TripInfo>, String> {
        Ok(self.get_trips()?.into_iter().find(|t| t.id == trip_id))
    }

    pub fn get_trackpoints(&self, trip_id: i64) -> Result<Vec<Trackpoint>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT timestamp, latitude, longitude, altitude, speed, heading,
                        satellites, fix_quality, hdop
                 FROM trackpoints WHERE trip_id=?1 ORDER BY timestamp",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![trip_id], |r| {
                Ok(Trackpoint {
                    timestamp: r.get(0)?,
                    latitude: r.get(1)?,
                    longitude: r.get(2)?,
                    altitude: r.get(3)?,
                    speed: r.get(4)?,
                    heading: r.get(5)?,
                    satellites: r.get(6)?,
                    fix_quality: r.get(7)?,
                    hdop: r.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn delete_trip(&self, trip_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM trips WHERE id=?1", params![trip_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn rename_trip(&self, trip_id: i64, name: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE trips SET name=?1 WHERE id=?2", params![name, trip_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
