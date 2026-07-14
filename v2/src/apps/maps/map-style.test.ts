import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerSpecification } from "maplibre-gl";
import { invoke } from "@tauri-apps/api/core";
import { buildOfflineStyle, CACHED_TILE_STYLE, resolveMapStyle } from "./map-style";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

function sourceLayerIds(style: { layers: LayerSpecification[] }): string[] {
  return style.layers.flatMap((layer) => {
    const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
    return sourceLayer === undefined ? [] : [sourceLayer];
  });
}

describe("offline Protomaps styles", () => {
  it("uses the Protomaps v4 source-layer contract for bundled PMTiles", () => {
    const style = buildOfflineStyle("tiles://resources/map/seattle.pmtiles");

    expect(style.sources).toHaveProperty("protomaps");
    expect(sourceLayerIds(style)).toEqual([
      "earth",
      "landcover",
      "landuse",
      "water",
      "roads",
      "roads",
      "roads",
      "roads",
      "buildings",
    ]);
    expect(style.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "road-minor", filter: ["==", "kind", "minor_road"] }),
      expect.objectContaining({ id: "road-primary", filter: ["all", ["==", "kind", "major_road"], ["in", "kind_detail", "primary", "primary_link", "trunk", "trunk_link"]] }),
      expect.objectContaining({ id: "road-motorway", filter: ["all", ["==", "kind", "highway"], ["in", "kind_detail", "motorway", "motorway_link"]] }),
      expect.objectContaining({ id: "building", filter: ["==", "kind", "building"] }),
    ]));
  });

  it("uses Carto's contract for downloaded cache tiles without remote font assets", () => {
    const serialized = JSON.stringify(CACHED_TILE_STYLE);

    expect(sourceLayerIds(CACHED_TILE_STYLE)).toEqual([
      "water",
      "landcover",
      "landuse",
      "transportation",
      "transportation",
      "transportation",
      "transportation",
      "building",
    ]);
    expect(serialized).toContain("transportation");
    expect(serialized).toContain('"class"');
    expect(CACHED_TILE_STYLE).not.toHaveProperty("glyphs");
    expect(CACHED_TILE_STYLE).not.toHaveProperty("sprite");
  });
});

describe("map style resolution", () => {
  it("tags PMTiles provenance and never probes online when PMTiles are available", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "default_pmtiles_url") return "tiles://resources/map/seattle.pmtiles";
      if (command === "tiles_exist") return true;
      return null;
    });

    const resolved = await resolveMapStyle();

    expect(resolved.provenance).toBe("local-pmtiles");
    expect(resolved.style).toHaveProperty("name", "Offline Dark");
    expect(mockedInvoke).not.toHaveBeenCalledWith("tiles_exist", undefined);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tags cache provenance and keeps it ahead of an available online style", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "default_pmtiles_url") return null;
      if (command === "tiles_exist") return true;
      return null;
    });

    const resolved = await resolveMapStyle();

    expect(resolved).toEqual({ style: CACHED_TILE_STYLE, provenance: "local-cache" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("probes online only after local options fail and tags online or blank fallback", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);

    await expect(resolveMapStyle()).resolves.toMatchObject({ provenance: "online" });

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await expect(resolveMapStyle()).resolves.toMatchObject({
      provenance: "blank",
      style: expect.objectContaining({ name: "Blank Dark" }),
    });
  });
});
