export interface SearchResult {
  name: string
  category: string // 'city' | 'road' | 'address' | 'poi'
  latitude: number
  longitude: number
  importance: number
  distance?: number // meters from current position
}

export interface RouteManeuver {
  type: string // 'turn', 'depart', 'arrive', 'merge', 'fork', 'roundabout', etc.
  modifier?: string // 'left', 'right', 'slight left', 'sharp right', 'straight', 'uturn'
  location: [number, number] // [lon, lat]
  bearingBefore: number
  bearingAfter: number
}

export interface RouteStep {
  maneuver: RouteManeuver
  name: string // street name
  distance: number // meters
  duration: number // seconds
  geometry: GeoJSON.LineString
}

export interface RouteData {
  geometry: GeoJSON.LineString // full route geometry
  distance: number // total meters
  duration: number // total seconds
  steps: RouteStep[]
}

export interface GeocodeResultsMessage {
  type: 'geocodeResults'
  results: SearchResult[]
}

export interface RouteDataMessage {
  type: 'routeData'
  route: RouteData
}

export interface NavStatusMessage {
  type: 'navStatus'
  routerRunning: boolean
  installedRegion: { regionId: string; regionName: string; status: string } | null
  installedSizeMb: number
  routerPort: number
}

export interface NavDownloadProgressMessage {
  type: 'navDownloadProgress'
  step: string
  percent: number
  downloadedMb: number
  totalMb: number
}

export interface NavProcessProgressMessage {
  type: 'navProcessProgress'
  step: string
  stepNumber: number
  totalSteps: number
  percent: number
}

export interface NavErrorMessage {
  type: 'navError'
  error: string
}

export interface NavRegionsMessage {
  type: 'navRegions'
  regions: Record<string, Array<{ id: string; name: string; estimatedSizeMb: number; group: string }>>
}
