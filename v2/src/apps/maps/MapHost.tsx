import { useCallback } from "react";

import { type MapHostId, useMapStore } from "../../stores/map-store";

// A host is intentionally empty: LiveMap owns its container and reparents it
// here imperatively, so changing screens never creates another MapLibre map.
export default function MapHost({ id, className }: { id: MapHostId; className?: string }) {
  const setHost = useMapStore((state) => state.setHost);
  const registerHost = useCallback(
    (element: HTMLDivElement | null) => setHost(id, element),
    [id, setHost]
  );

  return <div ref={registerHost} className={className ? `map-host ${className}` : "map-host"} />;
}
