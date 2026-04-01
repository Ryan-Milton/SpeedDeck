import { haversineDistance } from './utils'

/**
 * Perpendicular distance from a point to a line segment, with the closest point on the segment.
 * All coordinates in degrees (lat/lon). Returns distance in meters.
 */
export function pointToSegmentDistance(
  px: number, py: number, // point (lon, lat)
  ax: number, ay: number, // segment start (lon, lat)
  bx: number, by: number  // segment end (lon, lat)
): { distance: number; projection: [number, number]; t: number } {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  let t = 0
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
  }

  const projX = ax + t * dx
  const projY = ay + t * dy
  const distance = haversineDistance(py, px, projY, projX)

  return { distance, projection: [projX, projY], t }
}

/**
 * Find the nearest point on a route to the current position.
 * Searches a window around startIndex for efficiency.
 */
export function findNearestRoutePoint(
  lon: number, lat: number,
  coords: number[][], // [[lon, lat], ...]
  startIndex: number = 0,
  windowSize: number = 50
): { segmentIndex: number; distance: number; projection: [number, number] } {
  const from = Math.max(0, startIndex - 5)
  const to = Math.min(coords.length - 2, startIndex + windowSize)

  let bestDist = Infinity
  let bestIdx = from
  let bestProj: [number, number] = coords[from] as [number, number]

  for (let i = from; i <= to; i++) {
    const result = pointToSegmentDistance(
      lon, lat,
      coords[i][0], coords[i][1],
      coords[i + 1][0], coords[i + 1][1]
    )
    if (result.distance < bestDist) {
      bestDist = result.distance
      bestIdx = i
      bestProj = result.projection
    }
  }

  return { segmentIndex: bestIdx, distance: bestDist, projection: bestProj }
}

/**
 * Sum haversine distances between consecutive coordinates.
 */
export function distanceAlongCoords(coords: number[][], fromIdx: number, toIdx: number): number {
  let dist = 0
  for (let i = fromIdx; i < toIdx && i < coords.length - 1; i++) {
    dist += haversineDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0])
  }
  return dist
}

/**
 * Map OSRM maneuver type + modifier to a Lucide icon name.
 */
export function maneuverIcon(type: string, modifier?: string): string {
  if (type === 'depart') return 'Navigation'
  if (type === 'arrive') return 'MapPin'

  switch (modifier) {
    case 'left': return 'CornerUpLeft'
    case 'slight left': return 'ArrowUpLeft'
    case 'sharp left': return 'CornerDownLeft'
    case 'right': return 'CornerUpRight'
    case 'slight right': return 'ArrowUpRight'
    case 'sharp right': return 'CornerDownRight'
    case 'uturn': return 'UTurnLeft'
    case 'straight': return 'ArrowUp'
    default: return 'ArrowUp'
  }
}

/**
 * Generate human-readable turn instruction text.
 */
export function maneuverInstruction(type: string, modifier?: string, streetName?: string): string {
  if (type === 'depart') return streetName ? `Head on ${streetName}` : 'Depart'
  if (type === 'arrive') return 'Arrive at destination'

  const direction = modifier
    ? modifier.charAt(0).toUpperCase() + modifier.slice(1)
    : ''

  if (type === 'turn' || type === 'end of road' || type === 'new name') {
    if (streetName) return `${direction} onto ${streetName}`
    return direction || 'Continue'
  }
  if (type === 'merge') return streetName ? `Merge onto ${streetName}` : 'Merge'
  if (type === 'fork') return `Keep ${modifier || 'straight'}${streetName ? ` on ${streetName}` : ''}`
  if (type === 'roundabout' || type === 'rotary') return streetName ? `Take roundabout to ${streetName}` : 'Enter roundabout'
  if (type === 'continue') return streetName ? `Continue on ${streetName}` : 'Continue'

  return streetName ? `${direction} on ${streetName}` : direction || 'Continue'
}
