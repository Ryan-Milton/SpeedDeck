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
  const setRoute = useNavigationStore((s) => s.setRoute);
  const setCalculating = useNavigationStore((s) => s.setIsCalculating);
  const unit = useSettingsStore((s) => s.speedUnit);

  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      const fix = useVehicleStore.getState().state?.fix;
      try {
        setResults(await nav.geocode(query.trim(), fix?.latitude, fix?.longitude));
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, setResults]);

  if (!isOpen) return null;

  async function choose(lat: number, lon: number, name: string, category: string, importance: number) {
    const fix = useVehicleStore.getState().state?.fix;
    if (!fix) {
      setError("No GPS fix yet — can't route from current location.");
      return;
    }
    setDestination({ name, category, latitude: lat, longitude: lon, importance });
    setOpen(false);
    setCalculating(true);
    try {
      const route = await nav.calculateRoute(fix.longitude, fix.latitude, lon, lat);
      setRoute(route);
    } catch (e) {
      setError(String(e));
    } finally {
      setCalculating(false);
    }
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
        <button className="search-close" onClick={() => setOpen(false)}>
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
