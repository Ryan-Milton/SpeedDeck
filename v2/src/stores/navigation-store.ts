// Navigation state machine — ported from v1 stores/navigation-store.ts.
// Pure store logic; driven by the vehicle:state feed via useNavigation.

import { create } from "zustand";
import type { SearchResult, RouteData } from "../types/navigation";
import {
  findNearestRoutePoint,
  findNearestRoutePointFromCursor,
  buildCumulativeDistances,
  distanceAlongCumulativeFromProjection,
  computeBearing,
  computeOffRouteScore,
} from "../lib/nav-utils";

type NavStatus = "idle" | "previewing" | "navigating";

interface NavigationState {
  status: NavStatus;
  route: RouteData | null;
  origin: SearchResult | null; // null = use GPS position
  destination: SearchResult | null;

  activeStepIndex: number;
  distanceToNextManeuver: number; // meters
  distanceRemaining: number; // meters
  durationRemaining: number; // seconds
  eta: string; // HH:MM
  currentStreetName: string;
  isOffRoute: boolean;
  offRouteScore: number;
  offRouteTimestamp: number | null;
  navigationStartTime: number | null;
  currentSpeedLimit: number | null; // km/h

  searchResults: SearchResult[];
  searchQuery: string;
  isSearchOpen: boolean;
  isCalculating: boolean;
  routeRequestGeneration: number;

  osrmReady: boolean;
  osrmError: string | null;

  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setOrigin: (origin: SearchResult | null) => void;
  setDestination: (dest: SearchResult | null) => void;
  setRoute: (route: RouteData | null) => void;
  startNavigation: () => void;
  stopNavigation: () => void;
  updatePosition: (
    lat: number,
    lon: number,
    heading: number,
    speed: number,
    hdop?: number | null
  ) => void;
  setOsrmReady: (ready: boolean) => void;
  setOsrmStatus: (ready: boolean, error: string | null) => void;
  setIsCalculating: (calc: boolean) => void;
  beginRouteRequest: () => number;
  isRouteRequestCurrent: (generation: number) => boolean;
  applyRouteRequest: (generation: number, route: RouteData) => boolean;
  finishRouteRequest: (generation: number) => void;
  cancelRouteRequests: () => void;
}

interface RouteCache {
  cumulativeDistances: number[];
  stepRanges: { start: number; end: number }[];
  nearestSegmentCursor: number;
}

function buildStepCoordRanges(route: RouteData): { start: number; end: number }[] {
  const routeCoords = route.geometry.coordinates;
  const ranges: { start: number; end: number }[] = [];
  const coordIndices = new Map<string, number[]>();
  for (let i = 0; i < routeCoords.length; i++) {
    const key = `${routeCoords[i][0]},${routeCoords[i][1]}`;
    const indices = coordIndices.get(key);
    if (indices) indices.push(i);
    else coordIndices.set(key, [i]);
  }
  let searchFrom = 0;

  for (const step of route.steps) {
    const stepStart = step.maneuver.location;
    const exactMatches = coordIndices.get(`${stepStart[0]},${stepStart[1]}`);
    let bestIdx = exactMatches?.find((index) => index >= searchFrom);

    // OSRM maneuver coordinates normally occur verbatim in the overview
    // geometry. Retain a full-route nearest fallback for rounded geometries.
    if (bestIdx === undefined) {
      bestIdx = Math.max(
        searchFrom,
        findNearestRoutePoint(
          stepStart[0],
          stepStart[1],
          routeCoords,
          searchFrom,
          routeCoords.length
        ).segmentIndex
      );
    }
    ranges.push({ start: bestIdx, end: bestIdx });
    searchFrom = bestIdx;
  }

  for (let i = 0; i < ranges.length - 1; i++) {
    ranges[i].end = ranges[i + 1].start;
  }
  if (ranges.length > 0) {
    ranges[ranges.length - 1].end = routeCoords.length - 1;
  }

  return ranges;
}

function buildRouteCache(route: RouteData): RouteCache {
  return {
    cumulativeDistances: buildCumulativeDistances(route.geometry.coordinates),
    stepRanges: buildStepCoordRanges(route),
    nearestSegmentCursor: 0,
  };
}

function findStepIndexForSegment(
  ranges: { start: number; end: number }[],
  segmentIndex: number,
  fallback: number
): number {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (segmentIndex <= ranges[middle].end) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return low < ranges.length ? low : fallback;
}

let cachedRoute: RouteCache | null = null;

export const useNavigationStore = create<NavigationState>()((set, get) => ({
  status: "idle",
  route: null,
  origin: null,
  destination: null,
  activeStepIndex: 0,
  distanceToNextManeuver: 0,
  distanceRemaining: 0,
  durationRemaining: 0,
  eta: "",
  currentStreetName: "",
  isOffRoute: false,
  offRouteScore: 0,
  offRouteTimestamp: null,
  navigationStartTime: null,
  currentSpeedLimit: null,
  searchResults: [],
  searchQuery: "",
  isSearchOpen: false,
  isCalculating: false,
  routeRequestGeneration: 0,
  osrmReady: false,
  osrmError: null,

  setSearchOpen: (open) =>
    set({
      isSearchOpen: open,
      searchQuery: open ? "" : get().searchQuery,
      searchResults: open ? [] : get().searchResults,
    }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResults: (results) => set({ searchResults: results }),
  setOrigin: (origin) => set({ origin }),
  setDestination: (dest) => set({ destination: dest }),

  setRoute: (route) => {
    cachedRoute = route ? buildRouteCache(route) : null;
    const wasNavigating = get().status === "navigating";
    const newEta =
      wasNavigating && route
        ? new Date(Date.now() + (route.duration ?? 0) * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
    set({
      route,
      status: route ? (wasNavigating ? "navigating" : "previewing") : "idle",
      eta: newEta,
      activeStepIndex: 0,
      distanceToNextManeuver: 0,
      distanceRemaining: route?.distance ?? 0,
      durationRemaining: route?.duration ?? 0,
      isOffRoute: false,
      offRouteScore: 0,
      offRouteTimestamp: null,
      navigationStartTime: wasNavigating ? Date.now() : null,
      currentSpeedLimit: null,
      currentStreetName: wasNavigating ? route?.steps[0]?.name ?? "" : "",
    });
  },

  startNavigation: () => {
    const { route } = get();
    if (!route) return;
    set({
      status: "navigating",
      activeStepIndex: 0,
      distanceRemaining: route.distance,
      durationRemaining: route.duration,
      currentStreetName: route.steps[0]?.name ?? "",
      isOffRoute: false,
      offRouteScore: 0,
      offRouteTimestamp: null,
      navigationStartTime: Date.now(),
      currentSpeedLimit: null,
    });
  },

  stopNavigation: () => {
    cachedRoute = null;
    set({
      status: "idle",
      route: null,
      origin: null,
      destination: null,
      activeStepIndex: 0,
      distanceToNextManeuver: 0,
      distanceRemaining: 0,
      durationRemaining: 0,
      eta: "",
      currentStreetName: "",
      isOffRoute: false,
      offRouteScore: 0,
      offRouteTimestamp: null,
      navigationStartTime: null,
      currentSpeedLimit: null,
      isCalculating: false,
      routeRequestGeneration: get().routeRequestGeneration + 1,
    });
  },

  updatePosition: (lat, lon, heading, speed, hdop) => {
    const { route, status, activeStepIndex } = get();
    if (status !== "navigating" || !route) return;

    const coords = route.geometry.coordinates;
    const routeCache = cachedRoute ?? buildRouteCache(route);
    cachedRoute = routeCache;
    const nearest = findNearestRoutePointFromCursor(
      lon,
      lat,
      coords,
      routeCache.nearestSegmentCursor
    );
    routeCache.nearestSegmentCursor = Math.max(routeCache.nearestSegmentCursor, nearest.segmentIndex);

    const matchedStepIndex = findStepIndexForSegment(
      routeCache.stepRanges,
      nearest.segmentIndex,
      activeStepIndex
    );
    const newStepIndex = Math.max(activeStepIndex, matchedStepIndex);

    let distToNext = 0;
    if (newStepIndex < routeCache.stepRanges.length) {
      const stepEnd = routeCache.stepRanges[newStepIndex].end;
      distToNext = distanceAlongCumulativeFromProjection(
        routeCache.cumulativeDistances,
        nearest.segmentIndex,
        nearest.t,
        stepEnd
      );
    }

    const segEnd = Math.min(nearest.segmentIndex + 1, coords.length - 1);
    const routeBearing = computeBearing(
      coords[nearest.segmentIndex][1],
      coords[nearest.segmentIndex][0],
      coords[segEnd][1],
      coords[segEnd][0]
    );
    const { score } = computeOffRouteScore({
      distance: nearest.distance,
      heading,
      routeBearing,
      speed,
      hdop: hdop ?? null,
      distToManeuver: distToNext,
    });
    const offRoute = score > 0.7;

    const now = Date.now();
    let offRouteTimestamp = get().offRouteTimestamp;
    if (offRoute && !offRouteTimestamp) {
      offRouteTimestamp = now;
    } else if (!offRoute) {
      offRouteTimestamp = null;
    }

    const distFromHere = distanceAlongCumulativeFromProjection(
      routeCache.cumulativeDistances,
      nearest.segmentIndex,
      nearest.t,
      coords.length - 1
    );

    const totalDist = route.distance || 1;
    const osrmRemaining = route.duration * (distFromHere / totalDist);
    let durationRemaining = osrmRemaining;

    const { navigationStartTime } = get();
    const distTraveled = totalDist - distFromHere;

    if (navigationStartTime !== null && distTraveled > 100 && now - navigationStartTime > 30_000) {
      const actualElapsedSec = (now - navigationStartTime) / 1000;
      const osrmExpectedForTraveled = route.duration * (distTraveled / totalDist);
      if (osrmExpectedForTraveled > 0) {
        const paceFactor = Math.max(0.5, Math.min(3.0, actualElapsedSec / osrmExpectedForTraveled));
        durationRemaining = osrmRemaining * paceFactor;
      }
    }

    const eta = new Date(Date.now() + durationRemaining * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const currentStreetName = route.steps[newStepIndex]?.name ?? "";
    const currentSpeedLimit = route.maxspeeds?.[nearest.segmentIndex] ?? null;

    set({
      activeStepIndex: newStepIndex,
      distanceToNextManeuver: distToNext,
      distanceRemaining: distFromHere,
      durationRemaining,
      eta,
      currentStreetName,
      isOffRoute: offRoute,
      offRouteScore: score,
      offRouteTimestamp,
      currentSpeedLimit,
    });
  },

  setOsrmReady: (ready) => set({ osrmReady: ready }),
  setOsrmStatus: (ready, error) => set({ osrmReady: ready, osrmError: error }),
  setIsCalculating: (calc) => set({ isCalculating: calc }),
  beginRouteRequest: () => {
    const generation = get().routeRequestGeneration + 1;
    set({ routeRequestGeneration: generation });
    return generation;
  },
  isRouteRequestCurrent: (generation) => get().routeRequestGeneration === generation,
  applyRouteRequest: (generation, route) => {
    if (get().routeRequestGeneration !== generation) return false;
    get().setRoute(route);
    return true;
  },
  finishRouteRequest: (generation) => {
    if (get().routeRequestGeneration === generation) set({ isCalculating: false });
  },
  cancelRouteRequests: () =>
    set((state) => ({
      isCalculating: false,
      routeRequestGeneration: state.routeRequestGeneration + 1,
    })),
}));
