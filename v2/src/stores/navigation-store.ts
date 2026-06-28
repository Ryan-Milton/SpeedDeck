// Navigation state machine — ported from v1 stores/navigation-store.ts.
// Pure store logic; driven by the vehicle:state feed via useNavigation.

import { create } from "zustand";
import type { SearchResult, RouteData } from "../types/navigation";
import {
  findNearestRoutePoint,
  distanceAlongCoordsFromProjection,
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

  osrmReady: boolean;

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
  setIsCalculating: (calc: boolean) => void;
}

function buildStepCoordRanges(route: RouteData): { start: number; end: number }[] {
  const routeCoords = route.geometry.coordinates;
  const ranges: { start: number; end: number }[] = [];
  let searchFrom = 0;

  for (const step of route.steps) {
    const stepStart = step.maneuver.location;
    let bestIdx = searchFrom;
    let bestDist = Infinity;
    const limit = Math.min(searchFrom + 500, routeCoords.length);
    for (let i = searchFrom; i < limit; i++) {
      const dx = routeCoords[i][0] - stepStart[0];
      const dy = routeCoords[i][1] - stepStart[1];
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
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

let cachedStepRanges: { start: number; end: number }[] = [];

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
  osrmReady: false,

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
    cachedStepRanges = route ? buildStepCoordRanges(route) : [];
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
    cachedStepRanges = [];
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
    });
  },

  updatePosition: (lat, lon, heading, speed, hdop) => {
    const { route, status, activeStepIndex } = get();
    if (status !== "navigating" || !route) return;

    const coords = route.geometry.coordinates;
    const nearestSearchStart = cachedStepRanges[activeStepIndex]?.start ?? 0;

    const nearest = findNearestRoutePoint(lon, lat, coords, nearestSearchStart, 100);

    let newStepIndex = activeStepIndex;
    for (let i = activeStepIndex; i < cachedStepRanges.length; i++) {
      if (
        nearest.segmentIndex >= cachedStepRanges[i].start &&
        nearest.segmentIndex <= cachedStepRanges[i].end
      ) {
        newStepIndex = i;
        break;
      }
    }

    let distToNext = 0;
    if (newStepIndex < cachedStepRanges.length) {
      const stepEnd = cachedStepRanges[newStepIndex].end;
      distToNext = distanceAlongCoordsFromProjection(coords, nearest.segmentIndex, nearest.t, stepEnd);
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

    const distFromHere = distanceAlongCoordsFromProjection(
      coords,
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
  setIsCalculating: (calc) => set({ isCalculating: calc }),
}));
