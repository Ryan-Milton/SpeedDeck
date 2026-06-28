import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { resolveMapStyle, checkOnlineStyle } from "./map-style";
import { useVehicleStore } from "../../stores/vehicle-store";
import { useSettingsStore } from "../../stores/settings-store";

const DEFAULT_ZOOM = 16;
const DRIVING_PITCH = 50;
const SEATTLE: [number, number] = [-122.3321, 47.6062];
const CAMERA_PADDING = { top: 320, bottom: 0, left: 0, right: 0 };

// Live moving map — ported from v1 components/map/LiveMap.tsx. Driven by the
// Tauri `vehicle:state` feed (via useVehicleStore) instead of v1's WebSocket.
// Marker + camera are updated imperatively from a store subscription to avoid
// re-rendering React at the GPS rate (~10 Hz).
export default function LiveMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const lastFixRef = useRef<{ lon: number; lat: number; heading: number } | null>(null);
  const onlineRef = useRef(false);

  // --- init map once ---
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    (async () => {
      const style = await resolveMapStyle();
      if (cancelled || !containerRef.current) return;

      const init = useVehicleStore.getState().state?.fix;
      const center: [number, number] = init ? [init.longitude, init.latitude] : SEATTLE;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center,
        zoom: DEFAULT_ZOOM,
        bearing: init?.heading ?? 0,
        pitch: DRIVING_PITCH,
        attributionControl: false,
        dragRotate: true,
      });
      mapRef.current = map;

      map.on("load", () => {
        readyRef.current = true;
        addVehicleLayers(map, center);
        onlineRef.current = typeof style === "string";
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // --- follow live fixes (imperative, no React re-render) ---
  useEffect(() => {
    const unsub = useVehicleStore.subscribe((s) => {
      const map = mapRef.current;
      const fix = s.state?.fix;
      if (!map || !readyRef.current || !fix) return;

      const prev = lastFixRef.current;
      if (prev && prev.lon === fix.longitude && prev.lat === fix.latitude) return;
      lastFixRef.current = { lon: fix.longitude, lat: fix.latitude, heading: fix.heading };

      const src = map.getSource("vehicle") as maplibregl.GeoJSONSource | undefined;
      src?.setData(pointFeature(fix.longitude, fix.latitude));

      const orientation = useSettingsStore.getState().mapOrientation;
      if (orientation === "north-up") {
        map.easeTo({
          center: [fix.longitude, fix.latitude],
          bearing: 0,
          pitch: 0,
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          duration: 250,
        });
      } else {
        map.easeTo({
          center: [fix.longitude, fix.latitude],
          bearing: fix.heading,
          pitch: DRIVING_PITCH,
          padding: CAMERA_PADDING,
          duration: 250,
        });
      }
    });
    return unsub;
  }, []);

  // --- re-apply camera when the user toggles orientation ---
  useEffect(() => {
    const unsub = useSettingsStore.subscribe(() => {
      const map = mapRef.current;
      const fix = lastFixRef.current;
      if (!map || !readyRef.current || !fix) return;
      const orientation = useSettingsStore.getState().mapOrientation;
      map.easeTo({
        center: [fix.lon, fix.lat],
        bearing: orientation === "north-up" ? 0 : fix.heading,
        pitch: orientation === "north-up" ? 0 : DRIVING_PITCH,
        padding: orientation === "north-up" ? { top: 0, bottom: 0, left: 0, right: 0 } : CAMERA_PADDING,
        duration: 250,
      });
    });
    return unsub;
  }, []);

  // --- upgrade to the online style if connectivity returns ---
  useEffect(() => {
    const tryUpgrade = async () => {
      if (onlineRef.current || !mapRef.current || !readyRef.current) return;
      const url = await checkOnlineStyle();
      const map = mapRef.current;
      if (!url || !map) return;
      onlineRef.current = true;
      map.setStyle(url);
      map.once("styledata", () => {
        const last = lastFixRef.current;
        addVehicleLayers(map, last ? [last.lon, last.lat] : SEATTLE);
      });
    };
    const id = setInterval(tryUpgrade, 10_000);
    window.addEventListener("online", tryUpgrade);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", tryUpgrade);
    };
  }, []);

  return <div ref={containerRef} className="livemap" />;
}

function pointFeature(lon: number, lat: number): GeoJSON.Feature {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} };
}

function addVehicleLayers(map: maplibregl.Map, center: [number, number]) {
  if (map.getSource("vehicle")) return;
  map.addSource("vehicle", { type: "geojson", data: pointFeature(center[0], center[1]) });
  map.addLayer({
    id: "vehicle-glow",
    type: "circle",
    source: "vehicle",
    paint: { "circle-radius": 12, "circle-color": "#0A84FF", "circle-opacity": 0.3, "circle-blur": 0.5 },
  });
  map.addLayer({
    id: "vehicle-dot",
    type: "circle",
    source: "vehicle",
    paint: {
      "circle-radius": 7,
      "circle-color": "#0A84FF",
      "circle-stroke-width": 3,
      "circle-stroke-color": "#FFFFFF",
    },
  });
}
