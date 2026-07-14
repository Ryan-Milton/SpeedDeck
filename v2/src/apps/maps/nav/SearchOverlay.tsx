import { useEffect, useRef, useState } from "react";
import { nav } from "../../../lib/nav";
import { useNavigationStore } from "../../../stores/navigation-store";
import { useVehicleStore } from "../../../stores/vehicle-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { formatNavDistance } from "../../../lib/units";

// Destination search overlay: debounced geocode, then route from current GPS.
export default function SearchOverlay() {
  const isOpen = useNavigationStore((s) => s.isSearchOpen);
  const results = useNavigationStore((s) => s.searchResults);
  const setOpen = useNavigationStore((s) => s.setSearchOpen);
  const setResults = useNavigationStore((s) => s.setSearchResults);
  const setDestination = useNavigationStore((s) => s.setDestination);
  const setCalculating = useNavigationStore((s) => s.setIsCalculating);
  const beginRouteRequest = useNavigationStore((s) => s.beginRouteRequest);
  const isRouteRequestCurrent = useNavigationStore((s) => s.isRouteRequestCurrent);
  const applyRouteRequest = useNavigationStore((s) => s.applyRouteRequest);
  const finishRouteRequest = useNavigationStore((s) => s.finishRouteRequest);
  const cancelRouteRequests = useNavigationStore((s) => s.cancelRouteRequests);
  const unit = useSettingsStore((s) => s.speedUnit);

  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGeneration = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      searchGeneration.current += 1;
      setQuery("");
    }
  }, [isOpen]);

  useEffect(() => {
    const generation = ++searchGeneration.current;
    if (debounce.current) clearTimeout(debounce.current);
    if (!isOpen || query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      const fix = useVehicleStore.getState().state?.fix;
      try {
        const results = await nav.geocode(query.trim(), fix?.latitude, fix?.longitude);
        if (searchGeneration.current === generation) {
          setResults(results);
          setError(null);
        }
      } catch (e) {
        if (searchGeneration.current === generation) setError(String(e));
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [isOpen, query, setResults]);

  if (!isOpen) return null;

  async function choose(lat: number, lon: number, name: string, category: string, importance: number) {
    const fix = useVehicleStore.getState().state?.fix;
    if (!fix) {
      setError("No GPS fix yet — can't route from current location.");
      return;
    }
    setDestination({ name, category, latitude: lat, longitude: lon, importance });
    searchGeneration.current += 1;
    const generation = beginRouteRequest();
    setCalculating(true);
    try {
      const route = await nav.calculateRoute(fix.longitude, fix.latitude, lon, lat);
      if (applyRouteRequest(generation, route)) setOpen(false);
    } catch (e) {
      if (isRouteRequestCurrent(generation)) setError(String(e));
    } finally {
      finishRouteRequest(generation);
    }
  }

  function cancel() {
    cancelRouteRequests();
    setOpen(false);
  }

  return (
    <div className="search-overlay">
      <div className="search-head">
        <input
          autoFocus
          className="search-input"
          placeholder="Where to?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="search-close" onClick={cancel}>
          Cancel
        </button>
      </div>
      {error && <p className="search-error muted">{error}</p>}
      <ul className="search-results">
        {results.map((r, i) => (
          <li
            key={`${r.name}-${i}`}
            className="search-result"
            onClick={() => choose(r.latitude, r.longitude, r.name, r.category, r.importance)}
          >
            <span className="sr-name">{r.name}</span>
            <span className="sr-meta">
              {r.category}
              {r.distance ? ` · ${formatNavDistance(r.distance, unit)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
