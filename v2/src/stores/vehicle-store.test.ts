import { afterEach, describe, expect, it } from "vitest";
import type { ReceiverHealth, VehicleState } from "../lib/ipc";
import { useVehicleStore } from "./vehicle-store";

function state(sequence: number): VehicleState {
  return {
    sequence,
    receiverStatus: "fix",
    fix: {
      timestamp: "2026-07-13T00:00:00Z",
      latitude: 47.6062,
      longitude: -122.3321,
      altitude: 56,
      speed: 10,
      heading: 45,
      satellites: 12,
      fixQuality: 1,
      hdop: 0.9,
    },
    smoothedSpeed: 10,
    maxSpeed: 10,
    avgSpeed: 10,
    tripStatus: "idle",
    tripDistance: 0,
    tripDuration: 0,
    tripMaxSpeed: 0,
    tripAvgSpeed: 0,
    source: "gps",
  };
}

function health(sequence: number, status: ReceiverHealth["status"]): ReceiverHealth {
  return { sequence, source: "gps", status };
}

afterEach(() => {
  useVehicleStore.setState({ state: null, health: null, latestSequence: 0 });
});

describe("vehicle event ordering", () => {
  it("accepts state without a preceding health event and reasserts fix health", () => {
    useVehicleStore.getState().setState(state(2));

    const current = useVehicleStore.getState();
    expect(current.state?.sequence).toBe(2);
    expect(current.health).toEqual(health(2, "fix"));
  });

  it("rejects queued state older than stale or no-fix health", () => {
    const store = useVehicleStore.getState();
    store.setState(state(2));
    store.setHealth(health(4, "stale"));
    store.setState(state(3));

    expect(useVehicleStore.getState().state).toBeNull();
    expect(useVehicleStore.getState().health).toEqual(health(4, "stale"));
  });

  it("accepts the newest event regardless of listener delivery order", () => {
    const store = useVehicleStore.getState();
    store.setHealth(health(5, "nofix"));
    store.setHealth(health(3, "stale"));
    store.setState(state(4));
    store.setState(state(6));

    const current = useVehicleStore.getState();
    expect(current.state?.sequence).toBe(6);
    expect(current.health).toEqual(health(6, "fix"));
    expect(current.latestSequence).toBe(6);
  });
});
