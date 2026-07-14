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
pub const MAX_DOWNLOAD_ZOOM: u8 = 16;
pub const MAX_DOWNLOAD_TILES: u64 = 50_000;
const MAX_WEB_MERCATOR_LAT: f64 = 85.051_128_78;

pub fn lon2tile(lon: f64, z: u8) -> i64 {
    let z = z.min(MAX_DOWNLOAD_ZOOM);
    let tile_count = 1i64 << z;
    (((lon + 180.0) / 360.0) * tile_count as f64)
        .floor()
        .clamp(0.0, (tile_count - 1) as f64) as i64
}

pub fn lat2tile(lat: f64, z: u8) -> i64 {
    let z = z.min(MAX_DOWNLOAD_ZOOM);
    let tile_count = 1i64 << z;
    let lat_rad = lat
        .clamp(-MAX_WEB_MERCATOR_LAT, MAX_WEB_MERCATOR_LAT)
        .to_radians();
    (((1.0 - (lat_rad.tan() + 1.0 / lat_rad.cos()).ln() / std::f64::consts::PI) / 2.0)
        * tile_count as f64)
        .floor()
        .clamp(0.0, (tile_count - 1) as f64) as i64
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
pub fn enumerate_tiles(
    bbox: &BBox,
    min_zoom: u8,
    max_zoom: u8,
) -> Result<Vec<(u8, i64, i64)>, String> {
    let estimate = estimate(bbox, min_zoom, max_zoom)?;
    let mut tiles = Vec::with_capacity(estimate.tile_count as usize);
    for z in min_zoom..=max_zoom {
        let r = tile_range(bbox, z);
        for x in r.x_min..=r.x_max {
            for y in r.y_min..=r.y_max {
                tiles.push((z, x, y));
            }
        }
    }
    Ok(tiles)
}

pub fn estimate(bbox: &BBox, min_zoom: u8, max_zoom: u8) -> Result<TileEstimate, String> {
    validate_request(bbox, min_zoom, max_zoom)?;
    let mut count: u64 = 0;
    for z in min_zoom..=max_zoom {
        let r = tile_range(bbox, z);
        let w = (r.x_max - r.x_min + 1).max(0) as u64;
        let h = (r.y_max - r.y_min + 1).max(0) as u64;
        count = count
            .checked_add(w.checked_mul(h).ok_or("tile estimate overflow")?)
            .ok_or("tile estimate overflow")?;
        if count > MAX_DOWNLOAD_TILES {
            return Err(format!(
                "tile request exceeds the {MAX_DOWNLOAD_TILES} tile limit (estimated {count})"
            ));
        }
    }
    let mb = (count as f64 * AVG_TILE_SIZE_KB / 1024.0 * 10.0).round() / 10.0;
    Ok(TileEstimate {
        tile_count: count,
        estimated_size_mb: mb,
    })
}

fn validate_request(bbox: &BBox, min_zoom: u8, max_zoom: u8) -> Result<(), String> {
    if ![bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat]
        .into_iter()
        .all(f64::is_finite)
    {
        return Err("map bounds must be finite numbers".into());
    }
    if bbox.min_lon < -180.0 || bbox.max_lon > 180.0 || bbox.min_lon > bbox.max_lon {
        return Err("longitude bounds must be ordered values between -180 and 180".into());
    }
    if bbox.min_lat < -MAX_WEB_MERCATOR_LAT
        || bbox.max_lat > MAX_WEB_MERCATOR_LAT
        || bbox.min_lat > bbox.max_lat
    {
        return Err(format!(
            "latitude bounds must be ordered values between -{MAX_WEB_MERCATOR_LAT} and {MAX_WEB_MERCATOR_LAT}"
        ));
    }
    if min_zoom > max_zoom || max_zoom > MAX_DOWNLOAD_ZOOM {
        return Err(format!(
            "zoom range must be ordered and no greater than {MAX_DOWNLOAD_ZOOM}"
        ));
    }
    Ok(())
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
        assert_eq!(
            r,
            TileRange {
                x_min: 0,
                x_max: 0,
                y_min: 0,
                y_max: 0
            }
        );
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
        let count = enumerate_tiles(&SEATTLE, 10, 10).unwrap().len() as i64;
        assert_eq!(count, (r.x_max - r.x_min + 1) * (r.y_max - r.y_min + 1));
    }

    #[test]
    fn estimate_grows_with_zoom() {
        let lo = estimate(&SEATTLE, 0, 8).unwrap();
        let hi = estimate(&SEATTLE, 0, 12).unwrap();
        assert!(hi.tile_count > lo.tile_count);
        assert!(hi.estimated_size_mb >= lo.estimated_size_mb);
    }

    #[test]
    fn rejects_invalid_bounds_and_unbounded_downloads() {
        let invalid = BBox {
            min_lon: 1.0,
            max_lon: 0.0,
            ..SEATTLE
        };
        assert!(estimate(&invalid, 0, 10).is_err());
        assert!(estimate(&SEATTLE, 0, MAX_DOWNLOAD_ZOOM + 1).is_err());
        let world = BBox {
            min_lon: -180.0,
            min_lat: -85.0,
            max_lon: 180.0,
            max_lat: 85.0,
        };
        assert!(estimate(&world, 0, MAX_DOWNLOAD_ZOOM).is_err());
    }

    #[test]
    fn boundary_coordinates_stay_in_the_valid_tile_range() {
        assert_eq!(lon2tile(180.0, 1), 1);
        assert_eq!(lat2tile(MAX_WEB_MERCATOR_LAT, 1), 0);
    }
}
