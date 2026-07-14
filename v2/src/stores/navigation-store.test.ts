import { afterEach, describe, expect, it } from "vitest";
import type { RouteData } from "../types/navigation";
import { useNavigationStore } from "./navigation-store";

function makeLongRoute(): RouteData {
  const coordinates = Array.from({ length: 3_001 }, (_, index) => [
    -122.34 + index * 0.00001,
    47.606,
  ]);
  const steps: RouteData["steps"] = [0, 1_200, 2_400].map((index) => ({
    maneuver: {
      type: index === 0 ? "depart" : "continue",
      location: coordinates[index] as [number, number],
      bearingBefore: 90,
      bearingAfter: 90,
    },
    name: `Step ${index}`,
    distance: 1_000,
    duration: 60,
    geometry: { type: "LineString", coordinates: [coordinates[index], coordinates[index + 1]] },
  }));

  return {
    geometry: { type: "LineString", coordinates },
    distance: 30_000,
    duration: 1_800,
    steps,
  };
}

afterEach(() => useNavigationStore.getState().stopNavigation());

describe("navigation position updates", () => {
  it("advances its nearest-segment cursor across long routes and steps", () => {
    const route = makeLongRoute();
    const store = useNavigationStore.getState();
    store.setRoute(route);
    store.startNavigation();

    store.updatePosition(47.606, route.geometry.coordinates[1_500][0], 90, 20);
    const atMiddle = useNavigationStore.getState();
    expect(atMiddle.activeStepIndex).toBe(1);
    expect(atMiddle.currentStreetName).toBe("Step 1200");

    store.updatePosition(47.606, route.geometry.coordinates[2_700][0], 90, 20);
    const nearEnd = useNavigationStore.getState();
    expect(nearEnd.activeStepIndex).toBe(2);
    expect(nearEnd.currentStreetName).toBe("Step 2400");
    expect(nearEnd.distanceRemaining).toBeLessThan(atMiddle.distanceRemaining);
  });

  it("ignores a route response after navigation is stopped", () => {
    const store = useNavigationStore.getState();
    const generation = store.beginRouteRequest();
    store.stopNavigation();

    expect(store.applyRouteRequest(generation, makeLongRoute())).toBe(false);
    expect(useNavigationStore.getState().route).toBeNull();
  });

  it("ignores an in-flight route response after its generation is cancelled", () => {
    const store = useNavigationStore.getState();
    const generation = store.beginRouteRequest();

    store.cancelRouteRequests();

    expect(store.applyRouteRequest(generation, makeLongRoute())).toBe(false);
    expect(useNavigationStore.getState().route).toBeNull();
  });
});
