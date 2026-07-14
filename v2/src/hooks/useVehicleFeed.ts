// Subscribes to the backend `vehicle:state` event for the lifetime of the app
// and funnels it into the vehicle store. Mount once near the shell root.

import { useEffect } from "react";
import {
  onTripRecordingError,
  onTripStatus,
  onVehicleHealth,
  onVehicleState,
  type UnlistenFn,
} from "../lib/ipc";
import { useVehicleStore } from "../stores/vehicle-store";
import { toastError } from "../stores/ui-store";

export function useVehicleFeed(): void {
  const setState = useVehicleStore((s) => s.setState);
  const setHealth = useVehicleStore((s) => s.setHealth);
  const setTripStatus = useVehicleStore((s) => s.setTripStatus);
  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];
    const register = (subscription: Promise<UnlistenFn>) => {
      void subscription.then((unlisten) => {
        if (active) unlisteners.push(unlisten);
        else unlisten();
      });
    };

    register(onVehicleState((state) => active && setState(state)));
    register(onVehicleHealth((health) => active && setHealth(health)));
    register(onTripStatus((status) => active && setTripStatus(status)));
    register(
      onTripRecordingError((message) => {
        if (active) toastError(`Trip recording paused: ${message}`);
      })
    );
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [setHealth, setState, setTripStatus]);
}
