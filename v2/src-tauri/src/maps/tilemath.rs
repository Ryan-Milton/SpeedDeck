//! Slippy-map (Web Mercator) tile math — ported from v1 `main/tile-downloader.ts`.

use serde::{Deserialize, Serialize};

/// Geographic bounding box.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BBox {
    pub min_lon: f64,
    pub min_lat: f64,
    pub max_lon: f64,
    pub max_lat: f64,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TileEstimate {
    pub tile_count: u64,
    pub estimated_size_mb: f64,
}

/// Inclusive tile index range for a bbox at a zoom level.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TileRange {
    pub x_min: i64,
    pub x_max: i64,
    pub y_min: i64,
    pub y_max: i64,
}

const AVG_TILE_SIZE_KB: f64 = 5.0;

pub fn lon2tile(lon: f64, z: u8) -> i64 {
    (((lon + 180.0) / 360.0) * 2f64.powi(z as i32)).floor() as i64
}

pub fn lat2tile(lat: f64, z: u8) -> i64 {
    let lat_rad = lat.to_radians();
    (((1.0 - (lat_rad.tan() + 1.0 / lat_rad.cos()).ln() / std::f64::consts::PI) / 2.0)
        * 2f64.powi(z as i32))
    .floor() as i64
}

pub fn tile_range(bbox: &BBox, z: u8) -> TileRange {
    TileRange {
        x_min: lon2tile(bbox.min_lon, z),
        x_max: lon2tile(bbox.max_lon, z),
        // y is inverted: north (max_lat) maps to the smaller y.
        y_min: lat2tile(bbox.max_lat, z),
        y_max: lat2tile(bbox.min_lat, z),
    }
}

/// Every (z, x, y) tile covering `bbox` across the inclusive zoom span.
pub fn enumerate_tiles(bbox: &BBox, min_zoom: u8, max_zoom: u8) -> Vec<(u8, i64, i64)> {
    let mut tiles = Vec::new();
    for z in min_zoom..=max_zoom {
        let r = tile_range(bbox, z);
        for x in r.x_min..=r.x_max {
            for y in r.y_min..=r.y_max {
                tiles.push((z, x, y));
            }
        }
    }
    tiles
}

pub fn estimate(bbox: &BBox, min_zoom: u8, max_zoom: u8) -> TileEstimate {
    let mut count: u64 = 0;
    for z in min_zoom..=max_zoom {
        let r = tile_range(bbox, z);
        let w = (r.x_max - r.x_min + 1).max(0) as u64;
        let h = (r.y_max - r.y_min + 1).max(0) as u64;
        count += w * h;
    }
    let mb = (count as f64 * AVG_TILE_SIZE_KB / 1024.0 * 10.0).round() / 10.0;
    TileEstimate {
        tile_count: count,
        estimated_size_mb: mb,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEATTLE: BBox = BBox {
        min_lon: -122.6,
        min_lat: 47.0,
        max_lon: -122.0,
        max_lat: 47.8,
    };

    #[test]
    fn zoom0_is_single_tile() {
        let r = tile_range(&SEATTLE, 0);
        assert_eq!(r, TileRange { x_min: 0, x_max: 0, y_min: 0, y_max: 0 });
    }

    #[test]
    fn known_seattle_tile_z12() {
        // Seattle ~ (47.6062, -122.3321) at z12 -> tile x=656, y=1430.
        assert_eq!(lon2tile(-122.3321, 12), 656);
        assert_eq!(lat2tile(47.6062, 12), 1430);
    }

    #[test]
    fn range_is_ordered_and_inclusive() {
        let r = tile_range(&SEATTLE, 10);
        assert!(r.x_max >= r.x_min);
        assert!(r.y_max >= r.y_min); // north (max_lat) -> smaller y -> y_min
        let count = enumerate_tiles(&SEATTLE, 10, 10).len() as i64;
        assert_eq!(count, (r.x_max - r.x_min + 1) * (r.y_max - r.y_min + 1));
    }

    #[test]
    fn estimate_grows_with_zoom() {
        let lo = estimate(&SEATTLE, 0, 8);
        let hi = estimate(&SEATTLE, 0, 12);
        assert!(hi.tile_count > lo.tile_count);
        assert!(hi.estimated_size_mb >= lo.estimated_size_mb);
    }
}
