// Unit conversions — internal values are SI (m/s, meters). Mirrors v1 utils/units.py.

export const MPS_TO_MPH = 2.23694;
export const MPS_TO_KMH = 3.6;
export const MPS_TO_KNOTS = 1.94384;
export const METERS_TO_FEET = 3.28084;
export const METERS_TO_MI = 0.000621371;
export const METERS_TO_KM = 0.001;

export type SpeedUnit = "mph" | "kmh" | "knots";

export function speedConvert(mps: number, unit: SpeedUnit): number {
  switch (unit) {
    case "mph":
      return mps * MPS_TO_MPH;
    case "kmh":
      return mps * MPS_TO_KMH;
    case "knots":
      return mps * MPS_TO_KNOTS;
  }
}

export function distanceConvert(meters: number, unit: SpeedUnit): number {
  switch (unit) {
    case "mph":
      return meters * METERS_TO_MI;
    case "kmh":
      return meters * METERS_TO_KM;
    case "knots":
      return meters * METERS_TO_MI; // nautical handled elsewhere; mi is fine for display
  }
}

const CARDINALS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function cardinalDirection(heading: number): string {
  const idx = ((Math.round(heading / 22.5) % 16) + 16) % 16;
  return CARDINALS[idx];
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in meters (matches v1 utils.haversineDistance). */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(a));
}

export function speedUnitLabel(u: SpeedUnit): string {
  return u === "mph" ? "MPH" : u === "kmh" ? "KM/H" : "KN";
}

/** Human navigation distance: feet/meters when close, then mi/km/nm. */
export function formatNavDistance(meters: number, unit: SpeedUnit): string {
  if (unit === "kmh") {
    if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }
  if (unit === "knots") {
    if (meters < 185) return `${Math.round((meters * METERS_TO_FEET) / 10) * 10} ft`;
    return `${(meters * 0.000539957).toFixed(1)} nm`;
  }
  // mph (default)
  if (meters < 160) return `${Math.round((meters * METERS_TO_FEET) / 10) * 10} ft`;
  return `${(meters * METERS_TO_MI).toFixed(1)} mi`;
}
