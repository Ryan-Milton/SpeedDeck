// Subscribes to the backend `vehicle:state` event for the lifetime of the app
// and funnels it into the vehicle store. Mount once near the shell root.

import { useEffect } from "react";
import { onVehicleState } from "../lib/ipc";
import { useVehicleStore } from "../stores/vehicle-store";

export function useVehicleFeed(): void {
  const setState = useVehicleStore((s) => s.setState);
  useEffect(() => {
    const unlisten = onVehicleState(setState);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setState]);
}
