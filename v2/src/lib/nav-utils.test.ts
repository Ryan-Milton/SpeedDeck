import { describe, it, expect } from "vitest";
import {
  pointToSegmentDistance,
  findNearestRoutePoint,
  distanceAlongCoordsFromProjection,
  computeBearing,
  angleDifference,
  speedAdaptiveThreshold,
  computeOffRouteScore,
  maneuverInstruction,
} from "./nav-utils";

// A short straight route heading east near Seattle (~111 m per 0.001° lon here).
const ROUTE: number[][] = [
  [-122.3400, 47.6060],
  [-122.3380, 47.6060],
  [-122.3360, 47.6060],
  [-122.3340, 47.6060],
];

describe("pointToSegmentDistance", () => {
  it("is ~0 for a point on the segment", () => {
    const r = pointToSegmentDistance(-122.339, 47.606, -122.34, 47.606, -122.338, 47.606);
    expect(r.distance).toBeLessThan(1);
    expect(r.t).toBeGreaterThan(0);
    expect(r.t).toBeLessThan(1);
  });
  it("measures perpendicular offset", () => {
    // ~0.0009 deg lat north of the segment ≈ ~100 m.
    const r = pointToSegmentDistance(-122.339, 47.6069, -122.34, 47.606, -122.338, 47.606);
    expect(r.distance).toBeGreaterThan(80);
    expect(r.distance).toBeLessThan(120);
  });
});

describe("findNearestRoutePoint", () => {
  it("locates the closest segment", () => {
    const n = findNearestRoutePoint(-122.3370, 47.6060, ROUTE, 0, 100);
    expect(n.segmentIndex).toBe(1); // between idx1 and idx2
    expect(n.distance).toBeLessThan(5);
  });
});

describe("distanceAlongCoordsFromProjection", () => {
  it("sums remaining route distance", () => {
    // From the very start to the end ≈ 3 segments * ~150 m.
    const d = distanceAlongCoordsFromProjection(ROUTE, 0, 0, ROUTE.length - 1);
    expect(d).toBeGreaterThan(400);
    expect(d).toBeLessThan(500);
  });
  it("returns 0 when already at/after target", () => {
    expect(distanceAlongCoordsFromProjection(ROUTE, 3, 0.5, 2)).toBe(0);
  });
});

describe("computeBearing / angleDifference", () => {
  it("east is ~90°", () => {
    expect(computeBearing(47.606, -122.34, 47.606, -122.338)).toBeGreaterThan(88);
    expect(computeBearing(47.606, -122.34, 47.606, -122.338)).toBeLessThan(92);
  });
  it("wraps around 360", () => {
    expect(angleDifference(355, 5)).toBeCloseTo(10, 5);
    expect(angleDifference(10, 350)).toBeCloseTo(20, 5);
  });
});

describe("speedAdaptiveThreshold", () => {
  it("grows with speed and caps at 100", () => {
    expect(speedAdaptiveThreshold(0)).toBe(30);
    expect(speedAdaptiveThreshold(5)).toBe(30);
    expect(speedAdaptiveThreshold(20)).toBe(60);
    expect(speedAdaptiveThreshold(100)).toBe(100);
  });
});

describe("computeOffRouteScore", () => {
  it("on-route at speed scores low", () => {
    const { score } = computeOffRouteScore({
      distance: 3,
      heading: 90,
      routeBearing: 90,
      speed: 15,
      hdop: 0.9,
      distToManeuver: 500,
    });
    expect(score).toBeLessThan(0.7);
  });
  it("far off the route scores high", () => {
    const { score } = computeOffRouteScore({
      distance: 250,
      heading: 270, // opposite direction
      routeBearing: 90,
      speed: 15,
      hdop: 0.9,
      distToManeuver: 500,
    });
    expect(score).toBeGreaterThan(0.7);
  });
  it("low speed ignores heading (distance-only)", () => {
    const { headingScore } = computeOffRouteScore({
      distance: 20,
      heading: 0,
      routeBearing: 180,
      speed: 1,
      hdop: 1,
      distToManeuver: 500,
    });
    expect(headingScore).toBe(0);
  });
});

describe("maneuverInstruction", () => {
  it("formats common maneuvers", () => {
    expect(maneuverInstruction("depart", undefined, "Pine St")).toBe("Head on Pine St");
    expect(maneuverInstruction("turn", "left", "5th Ave")).toBe("Left onto 5th Ave");
    expect(maneuverInstruction("arrive")).toBe("Arrive at destination");
  });
});
