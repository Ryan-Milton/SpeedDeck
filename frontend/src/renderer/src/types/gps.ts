export interface GpsFixData {
  timestamp: string
  latitude: number
  longitude: number
  altitude: number | null
  speed: number // m/s
  heading: number
  satellites: number
  fixQuality: number // 0=none, 1=GPS, 2=DGPS
  hdop: number | null
}

export interface GpsStateMessage {
  type: 'gpsState'
  fix: GpsFixData
  smoothedSpeed: number
  maxSpeed: number
  avgSpeed: number
  tripStatus: 'idle' | 'recording' | 'paused'
  tripDistance: number
  tripDuration: number
  tripMaxSpeed: number
  tripAvgSpeed: number
}

export interface TripInfo {
  id: number
  name: string | null
  startedAt: string
  endedAt: string | null
  distanceM: number
  maxSpeed: number
  avgSpeed: number
}

export interface TripListMessage {
  type: 'tripList'
  trips: TripInfo[]
}

export interface GpxDataMessage {
  type: 'gpxData'
  tripId: number
  gpxXml: string
}

export interface Trackpoint {
  timestamp: string
  latitude: number
  longitude: number
  altitude: number | null
  speed: number // m/s
  heading: number
  satellites: number
  fixQuality: number
  hdop: number | null
}

export interface TrackpointsDataMessage {
  type: 'trackpointsData'
  tripId: number
  trackpoints: Trackpoint[]
}

export type ServerMessage = GpsStateMessage | TripListMessage | GpxDataMessage | TrackpointsDataMessage

export type SpeedUnit = 'mph' | 'kmh' | 'knots'
export type AltitudeUnit = 'ft' | 'm'
export type CoordFormat = 'dd' | 'dms'
