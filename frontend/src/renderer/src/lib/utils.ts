import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

const MPS_TO_MPH = 2.23694
const MPS_TO_KMH = 3.6
const MPS_TO_KNOTS = 1.94384
const METERS_TO_FEET = 3.28084
const METERS_TO_MI = 0.000621371
const METERS_TO_KM = 0.001
const METERS_TO_NM = 0.000539957

export function convertSpeed(mps: number, unit: string): number {
  if (unit === 'mph') return mps * MPS_TO_MPH
  if (unit === 'kmh') return mps * MPS_TO_KMH
  if (unit === 'knots') return mps * MPS_TO_KNOTS
  return mps
}

export function convertDistance(meters: number, unit: string): number {
  if (unit === 'mph') return meters * METERS_TO_MI
  if (unit === 'kmh') return meters * METERS_TO_KM
  if (unit === 'knots') return meters * METERS_TO_NM
  return meters
}

export function convertAltitude(meters: number, unit: string): number {
  if (unit === 'ft') return meters * METERS_TO_FEET
  return meters
}

export function speedUnitLabel(unit: string): string {
  if (unit === 'mph') return 'MPH'
  if (unit === 'kmh') return 'KM/H'
  if (unit === 'knots') return 'KTS'
  return unit.toUpperCase()
}

export function distanceUnitLabel(unit: string): string {
  if (unit === 'mph') return 'MI'
  if (unit === 'kmh') return 'KM'
  if (unit === 'knots') return 'NM'
  return 'M'
}

export function altitudeUnitLabel(unit: string): string {
  if (unit === 'ft') return 'FT'
  return 'M'
}

export function formatCoord(deg: number, isLat: boolean): string {
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W'
  return `${Math.abs(deg).toFixed(4)}° ${dir}`
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180
  return ((a + diff * t) + 360) % 360
}

const EARTH_RADIUS_M = 6_371_000

export function haversineDistance(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(a))
}

export function distance3d(
  lat1: number, lon1: number, alt1: number | null,
  lat2: number, lon2: number, alt2: number | null
): number {
  const horiz = haversineDistance(lat1, lon1, lat2, lon2)
  if (alt1 != null && alt2 != null) {
    const dalt = alt2 - alt1
    return Math.sqrt(horiz ** 2 + dalt ** 2)
  }
  return horiz
}

export function cardinalDirection(heading: number): string {
  const dirs = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
  ]
  return dirs[Math.round(heading / 22.5) % 16]
}
