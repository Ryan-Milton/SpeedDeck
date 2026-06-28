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
