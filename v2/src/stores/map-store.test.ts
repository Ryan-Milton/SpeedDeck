import { afterEach, describe, expect, it } from "vitest";

import { useMapStore } from "./map-store";

afterEach(() => {
  useMapStore.setState({
    following: true,
    activeHost: null,
    hosts: { maps: null, dashboard: null },
  });
});

describe("map host ownership", () => {
  it("keeps registered hosts separate from the active map owner", () => {
    const mapsHost = {} as HTMLElement;
    const dashboardHost = {} as HTMLElement;
    const store = useMapStore.getState();

    store.setHost("maps", mapsHost);
    store.setHost("dashboard", dashboardHost);
    store.setActiveHost("maps");

    expect(useMapStore.getState().hosts).toEqual({ maps: mapsHost, dashboard: dashboardHost });
    expect(useMapStore.getState().activeHost).toBe("maps");

    useMapStore.getState().setActiveHost("dashboard");
    expect(useMapStore.getState().activeHost).toBe("dashboard");
  });
});
