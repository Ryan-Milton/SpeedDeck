// Navigation types — ported from v1 types/navigation.ts.

export interface SearchResult {
  name: string;
  category: string; // 'city' | 'road' | 'address' | 'poi'
  latitude: number;
  longitude: number;
  importance: number;
  distance?: number; // meters from current position
  source?: string; // 'offline' | 'online'
}

export interface RouteManeuver {
  type: string; // 'turn' | 'depart' | 'arrive' | 'merge' | 'fork' | 'roundabout' | ...
  modifier?: string; // 'left' | 'right' | 'slight left' | ...
  location: [number, number]; // [lon, lat]
  bearingBefore: number;
  bearingAfter: number;
}

export interface RouteStep {
  maneuver: RouteManeuver;
  name: string;
  distance: number; // meters
  duration: number; // seconds
  geometry: GeoJSON.LineString;
}

export interface RouteData {
  geometry: GeoJSON.LineString;
  distance: number; // total meters
  duration: number; // total seconds (OSRM estimate)
  steps: RouteStep[];
  maxspeeds?: (number | null)[]; // per-segment, km/h
}
