// Drives navigation off the live GPS feed: advances the route as the vehicle
// moves and reroutes when off-route. Ported from v1 hooks/useNavigation.ts,
// with the WebSocket replaced by Tauri invoke/listen.

import { useEffect, useRef } from "react";
import { nav, onNavStatus } from "../lib/nav";
import { useNavigationStore } from "../stores/navigation-store";
import { useVehicleStore } from "../stores/vehicle-store";

const MIN_REROUTE_DELAY_MS = 1500;
const MAX_REROUTE_DELAY_MS = 4000;
const REROUTE_DISTANCE_M = 40;
const MAX_RETRIES = 5;

export function useNavigation(): void {
  const rerouteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);
  const lastActivityAt = useRef(0);

  // OSRM router status.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    nav
      .status()
      .then((s) => {
        if (!disposed) {
          useNavigationStore.getState().setOsrmStatus(s.routerRunning, s.routerError);
        }
      })
      .catch(() => {});
    onNavStatus((s) => {
      if (!disposed) {
        useNavigationStore.getState().setOsrmStatus(s.routerRunning, s.routerError);
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Advance the route from each GPS fix while navigating.
  useEffect(() => {
    return useVehicleStore.subscribe((s) => {
      const navState = useNavigationStore.getState();
      if (navState.status !== "navigating" || !s.state) return;
      if (Date.now() - lastActivityAt.current >= 30_000) {
        lastActivityAt.current = Date.now();
        void nav.noteActivity().catch(() => {});
      }
      const f = s.state.fix;
      navState.updatePosition(
        f.latitude,
        f.longitude,
        f.heading,
        s.state.smoothedSpeed,
        f.hdop ?? null
      );
    });
  }, []);

  // Reroute when the off-route flag flips on.
  useEffect(() => {
    const clearTimer = () => {
      if (rerouteTimer.current) {
        clearTimeout(rerouteTimer.current);
        rerouteTimer.current = null;
      }
    };

    const doReroute = async () => {
      const navState = useNavigationStore.getState();
      const veh = useVehicleStore.getState().state;
      if (navState.status !== "navigating" || !navState.isOffRoute || !navState.destination || !veh) {
        return;
      }
      const f = veh.fix;
      const requestGeneration = navState.beginRouteRequest();
      try {
        const route = await nav.calculateRoute(
          f.longitude,
          f.latitude,
          navState.destination.longitude,
          navState.destination.latitude,
          f.heading,
          veh.smoothedSpeed
        );
        const current = useNavigationStore.getState();
        if (
          current.status === "navigating" &&
          current.isOffRoute &&
          current.isRouteRequestCurrent(requestGeneration) &&
          current.applyRouteRequest(requestGeneration, route)
        ) {
          retryCount.current = 0;
        }
      } catch {
        if (!useNavigationStore.getState().isRouteRequestCurrent(requestGeneration)) return;
        retryCount.current += 1;
        if (retryCount.current <= MAX_RETRIES && useNavigationStore.getState().isOffRoute) {
          rerouteTimer.current = setTimeout(doReroute, 3000 * 2 ** (retryCount.current - 1));
        }
      }
    };

    const scheduleReroute = () => {
      const speed = useVehicleStore.getState().state?.smoothedSpeed ?? 0;
      const delay =
        speed > 0
          ? Math.max(MIN_REROUTE_DELAY_MS, Math.min(MAX_REROUTE_DELAY_MS, (REROUTE_DISTANCE_M / speed) * 1000))
          : MAX_REROUTE_DELAY_MS;
      clearTimer();
      rerouteTimer.current = setTimeout(doReroute, delay);
    };

    const unsub = useNavigationStore.subscribe((s, prev) => {
      if (s.isOffRoute === prev.isOffRoute) return;
      if (s.isOffRoute && s.status === "navigating") {
        retryCount.current = 0;
        scheduleReroute();
      } else {
        clearTimer();
        retryCount.current = 0;
        // A route response that started while off-route must not replace the
        // active route after GPS matching has recovered.
        s.cancelRouteRequests();
      }
    });

    return () => {
      unsub();
      clearTimer();
    };
  }, []);
}
