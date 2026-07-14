import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  resolveMapStyle,
  checkOnlineStyle,
  type MapStyleProvenance,
} from "./map-style";
import { MAP_ACCENT, MAP_ACCENT_GLOW, MAP_ROUTE_OUTLINE } from "./theme";
import { useVehicleStore } from "../../stores/vehicle-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useNavigationStore } from "../../stores/navigation-store";
import { useMapStore } from "../../stores/map-store";

const DEFAULT_ZOOM = 16;
const DRIVING_PITCH = 50;
const SEATTLE: [number, number] = [-122.3321, 47.6062];
const CAMERA_PADDING = { top: 320, bottom: 0, left: 0, right: 0 };
const CAMERA_INTERVAL_MS = 500;
const CAMERA_POSITION_THRESHOLD_METERS = 3;
const CAMERA_HEADING_THRESHOLD_DEGREES = 4;

interface Fix {
  lon: number;
  lat: number;
  heading: number;
}

// One controller is mounted by Shell for the lifetime of the UI. It owns one
// DOM node and reparents it to the active Maps or Dashboard host.
export default function LiveMap() {
  useEffect(() => {
    let disposed = false;
    let host: HTMLElement | null = null;
    let map: maplibregl.Map | null = null;
    let mapReady = false;
    let initializing: Promise<void> | null = null;
    let styleProvenance: MapStyleProvenance | null = null;
    let styleDirty = false;
    let sourceUnlisten: UnlistenFn | null = null;
    let resizeFrame: number | null = null;
    let cameraTimer: number | null = null;
    let onlineTimer: number | null = null;
    let pendingCamera: Fix | null = null;
    let pendingCameraForced = false;
    let lastFix: Fix | null = null;
    let lastMarkerFix: Fix | null = null;
    let lastCameraFix: Fix | null = null;
    let lastCameraAt = 0;
    let unsubscribeActivity: Array<() => void> = [];

    const container = document.createElement("div");
    container.className = "livemap";

    const active = () => !disposed && host !== null;
    const clearCameraQueue = () => {
      if (cameraTimer !== null) window.clearTimeout(cameraTimer);
      cameraTimer = null;
      pendingCamera = null;
      pendingCameraForced = false;
    };
    const stopOnlineChecks = () => {
      if (onlineTimer !== null) window.clearInterval(onlineTimer);
      onlineTimer = null;
      window.removeEventListener("online", tryUpgradeStyle);
    };
    const stopActivity = () => {
      unsubscribeActivity.forEach((unsubscribe) => unsubscribe());
      unsubscribeActivity = [];
      stopOnlineChecks();
      clearCameraQueue();
      map?.stop();
    };
    const scheduleResize = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (active() && map) map.resize();
      });
    };
    const applyCamera = (fix: Fix, duration: number, zoom?: number) => {
      if (!map || !active()) return;
      const northUp = useSettingsStore.getState().mapOrientation === "north-up";
      map.easeTo({
        center: [fix.lon, fix.lat],
        ...(zoom === undefined ? {} : { zoom }),
        bearing: northUp ? 0 : fix.heading,
        pitch: northUp ? 0 : DRIVING_PITCH,
        padding: northUp ? { top: 0, bottom: 0, left: 0, right: 0 } : CAMERA_PADDING,
        duration,
      });
      lastCameraFix = fix;
      lastCameraAt = Date.now();
    };
    const flushCamera = () => {
      cameraTimer = null;
      const fix = pendingCamera;
      const forced = pendingCameraForced;
      pendingCamera = null;
      pendingCameraForced = false;
      if (!fix || !active() || !mapReady || !useMapStore.getState().following) return;
      if (!forced && !cameraNeedsUpdate(lastCameraFix, fix)) return;
      applyCamera(fix, 300);
    };
    const queueCamera = (fix: Fix, forced = false) => {
      if (!active() || !mapReady || !map || !useMapStore.getState().following) return;
      if (!forced && !cameraNeedsUpdate(lastCameraFix, fix)) return;
      pendingCamera = fix;
      pendingCameraForced ||= forced;
      if (cameraTimer !== null) return;
      const delay = forced ? 0 : Math.max(0, CAMERA_INTERVAL_MS - (Date.now() - lastCameraAt));
      if (delay === 0) {
        flushCamera();
      } else {
        cameraTimer = window.setTimeout(flushCamera, delay);
      }
    };
    const focusCamera = (duration: number, zoom?: number) => {
      const fix = lastFix;
      if (!fix || !map || !mapReady || !active()) return;
      clearCameraQueue();
      map.stop();
      applyCamera(fix, duration, zoom);
    };
    const updateFix = () => {
      const fix = useVehicleStore.getState().state?.fix;
      if (!fix || !map || !mapReady || !active()) return;
      const next = { lon: fix.longitude, lat: fix.latitude, heading: fix.heading };
      lastFix = next;
      if (!lastMarkerFix || lastMarkerFix.lon !== next.lon || lastMarkerFix.lat !== next.lat) {
        const source = map.getSource("vehicle") as maplibregl.GeoJSONSource | undefined;
        source?.setData(pointFeature(next.lon, next.lat));
        lastMarkerFix = next;
      }
      queueCamera(next);
    };
    const ensureLayers = (target: maplibregl.Map) => {
      if (!target.isStyleLoaded()) return;
      const fix = lastFix ?? vehicleFix();
      addRouteLayers(target);
      addVehicleLayers(target, fix ? [fix.lon, fix.lat] : SEATTLE);
      applyRoute(target);
    };
    const startOnlineChecks = () => {
      if (styleProvenance !== "blank" || onlineTimer !== null) return;
      onlineTimer = window.setInterval(tryUpgradeStyle, 10_000);
      window.addEventListener("online", tryUpgradeStyle);
    };
    async function tryUpgradeStyle() {
      if (styleProvenance !== "blank" || !active() || !map || !mapReady) return;
      const url = await checkOnlineStyle();
      if (!url || styleProvenance !== "blank" || !active() || !map) return;
      styleProvenance = "online";
      map.once("style.load", () => {
        if (!active() || !map) return;
        ensureLayers(map);
        updateFix();
      });
      map.setStyle(url);
      stopOnlineChecks();
    }
    async function refreshResolvedStyle() {
      if (!map || !mapReady) return;
      const resolved = await resolveMapStyle();
      if (disposed || !map || !mapReady) return;
      styleDirty = false;
      styleProvenance = resolved.provenance;
      map.once("style.load", () => {
        if (!active() || !map) return;
        ensureLayers(map);
        updateFix();
        startOnlineChecks();
      });
      map.setStyle(resolved.style);
      stopOnlineChecks();
    }
    const startActivity = () => {
      if (!active() || !map || !mapReady || unsubscribeActivity.length > 0) return;
      if (styleDirty) {
        void refreshResolvedStyle();
      }
      ensureLayers(map);
      updateFix();
      unsubscribeActivity = [
        useVehicleStore.subscribe(updateFix),
        useSettingsStore.subscribe((state, previous) => {
          if (state.mapOrientation !== previous.mapOrientation) focusCamera(250);
        }),
        useMapStore.subscribe((state, previous) => {
          if (state.following && !previous.following) focusCamera(400, DEFAULT_ZOOM);
        }),
        useNavigationStore.subscribe((state, previous) => {
          if (state.route !== previous.route && map && mapReady) applyRoute(map);
        }),
      ];
      startOnlineChecks();
    };
    const ensureMap = async () => {
      if (map || initializing) return initializing;
      initializing = (async () => {
        const resolvedStyle = await resolveMapStyle();
        if (disposed || !active() || !container.isConnected) return;
        const fix = vehicleFix();
        const center: [number, number] = fix ? [fix.lon, fix.lat] : SEATTLE;
        map = new maplibregl.Map({
          container,
          style: resolvedStyle.style,
          center,
          zoom: DEFAULT_ZOOM,
          bearing: fix?.heading ?? 0,
          pitch: DRIVING_PITCH,
          attributionControl: false,
          dragRotate: true,
        });
        styleProvenance = resolvedStyle.provenance;
        map.on("dragstart", unfollowCamera);
        map.on("zoomstart", unfollowCamera);
        map.on("rotatestart", unfollowCamera);
        map.on("load", () => {
          if (disposed || !map) return;
          mapReady = true;
          ensureLayers(map);
          scheduleResize();
          startActivity();
        });
      })();
      try {
        await initializing;
      } finally {
        initializing = null;
      }
    };
    const unfollowCamera = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) useMapStore.getState().setFollowing(false);
    };
    const setHost = (nextHost: HTMLElement | null) => {
      if (host === nextHost) return;
      stopActivity();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
      if (container.parentElement) container.remove();
      host = nextHost;
      if (!host) return;
      host.appendChild(container);
      if (mapReady && map) {
        startActivity();
        // Reparenting stops an in-progress ease. Apply the latest fix even if
        // it matches the last requested camera target.
        focusCamera(0);
      }
      void ensureMap();
      scheduleResize();
    };
    const activeHost = (state = useMapStore.getState()): HTMLElement | null =>
      state.activeHost ? state.hosts[state.activeHost] : null;
    const unsubscribeHost = useMapStore.subscribe((state, previous) => {
      const nextHost = activeHost(state);
      if (nextHost !== activeHost(previous)) setHost(nextHost);
    });
    void listen("maps:source-changed", () => {
      styleDirty = true;
      if (active()) void refreshResolvedStyle();
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else sourceUnlisten = unlisten;
      })
      .catch(() => {});

    setHost(activeHost());
    return () => {
      disposed = true;
      unsubscribeHost();
      sourceUnlisten?.();
      setHost(null);
      map?.remove();
    };
  }, []);

  return null;
}

function vehicleFix(): Fix | null {
  const fix = useVehicleStore.getState().state?.fix;
  return fix ? { lon: fix.longitude, lat: fix.latitude, heading: fix.heading } : null;
}

function cameraNeedsUpdate(previous: Fix | null, next: Fix): boolean {
  if (!previous) return true;
  return (
    distanceMeters(previous, next) >= CAMERA_POSITION_THRESHOLD_METERS ||
    headingDifference(previous.heading, next.heading) >= CAMERA_HEADING_THRESHOLD_DEGREES
  );
}

function distanceMeters(a: Fix, b: Fix): number {
  const latitudeRadians = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const latitudeDistance = (b.lat - a.lat) * 111_320;
  const longitudeDistance = (b.lon - a.lon) * 111_320 * Math.cos(latitudeRadians);
  return Math.hypot(latitudeDistance, longitudeDistance);
}

function headingDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function pointFeature(lon: number, lat: number): GeoJSON.Feature {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} };
}

const EMPTY_LINE: GeoJSON.Feature = {
  type: "Feature",
  geometry: { type: "LineString", coordinates: [] },
  properties: {},
};

function addRouteLayers(map: maplibregl.Map) {
  if (map.getSource("route")) return;
  map.addSource("route", { type: "geojson", data: EMPTY_LINE });
  map.addLayer({
    id: "route-outline",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": 9, "line-color": MAP_ROUTE_OUTLINE, "line-opacity": 0.35 },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": 6, "line-color": MAP_ACCENT, "line-opacity": 0.9 },
  });
}

function applyRoute(map: maplibregl.Map) {
  const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const route = useNavigationStore.getState().route;
  source.setData(route ? { type: "Feature", geometry: route.geometry, properties: {} } : EMPTY_LINE);
}

function addVehicleLayers(map: maplibregl.Map, center: [number, number]) {
  if (map.getSource("vehicle")) return;
  map.addSource("vehicle", { type: "geojson", data: pointFeature(center[0], center[1]) });
  map.addLayer({
    id: "vehicle-glow",
    type: "circle",
    source: "vehicle",
    paint: { "circle-radius": 12, "circle-color": MAP_ACCENT_GLOW, "circle-blur": 0.5 },
  });
  map.addLayer({
    id: "vehicle-dot",
    type: "circle",
    source: "vehicle",
    paint: {
      "circle-radius": 7,
      "circle-color": MAP_ACCENT,
      "circle-stroke-width": 3,
      "circle-stroke-color": "#FFFFFF",
    },
  });
}
