# Phase 6 — Turn-by-Turn Navigation: Implementation Plan

**Status:** Approved, not yet started
**Target:** SpeedDeck v2 (Tauri 2 + React), branch `claude/steamdeck-carplay-gps-lhoqu6`
**Depends on:** Phase 2 (vehicle layer), Phase 4 (offline maps + tile downloader)
**Reference:** v1 navigation under `v1/backend/gps_speedometer/navigation/` and
`v1/frontend/src/renderer/src/{stores,lib,hooks,components}/`

---

## 1. Summary

Add offline-capable, CarPlay-style turn-by-turn navigation to v2: destination search, route
calculation, on-route guidance (turn banner, ETA, speed limit), and automatic rerouting — driven
by the existing GPS `vehicle:state` feed. The routing engine (`osrm-routed`) runs on-device as a
Tauri **sidecar**; the routing graph and geocoding index are **prebuilt off-device** and
**downloaded in-app**. The map continues to use MapLibre + PMTiles from Phase 4, with route and
maneuver layers added.

This phase ports proven v1 logic — the OSRM request shape, the speed-adaptive bearing constraint,
the off-route scoring, the pace-factor ETA, and the maneuver formatting — rather than reinventing
it. The Python↔WebSocket transport is replaced by Tauri `invoke`/`emit`, consistent with Phases 2–5.

## 2. Goals

- Search a destination offline (prebuilt FTS5 index) with an online Nominatim fallback.
- Calculate a driving route via local OSRM and render it on the live map.
- Provide on-route guidance: next-maneuver banner, distance-to-turn, ETA, distance/time remaining,
  current speed limit.
- Detect going off-route and reroute automatically, with speed-adaptive timing and backoff.
- Work with **no connectivity** once a region pack is installed.

## 3. Non-goals (this phase)

- Building routing graphs or geocoding indexes **on the device** (too heavy for the Deck).
- Lane guidance, live traffic, alternative routes, multi-stop routing.
- A pure-Rust router (kept as a future option behind the same module seam).
- Voice guidance (candidate for a later phase).

## 4. Decisions (confirmed)

| Decision | Choice | Rationale |
|---|---|---|
| Routing data delivery | **In-app download** of prebuilt region packs | Keeps the AppImage small; WA MLD graph is several hundred MB. |
| Geocoding | **Offline FTS5 + Nominatim online fallback** | No-signal search in-car, with online recovery for out-of-pack queries. |
| Routing engine | **Bundled `osrm-routed` Tauri sidecar** | Reuses v1's exact routing behavior; avoids a large pure-Rust effort now. |
| Graph build | **Off-device** via `osrm/osrm-backend` Docker image | The Deck only runs the engine, never `extract`/`partition`/`customize`. |

## 5. Architecture

```
GPS receiver ──► vehicle:state (Phase 2) ──► useNavigation (FE) ──► navigation-store.updatePosition()
                                                                          │
 SearchOverlay ──invoke('geocode_search')──► nav::geocoder ──┐           │ (off-route?)
 RoutePreview  ──invoke('calculate_route')─► nav::router ────┼─► osrm-routed sidecar (127.0.0.1:5001)
 Settings      ──invoke('nav_download_region')─► nav packs   │           │
                                                             └─► routeData ──► store.setRoute()
                                                                          │
                                          LiveMap (route + maneuver layers) ◄──┘
```

- **Rust** owns the OSRM sidecar lifecycle, route requests, geocoding, and region-pack management.
- **Frontend** owns all *guidance* math (projection, off-route, ETA, step advance) and the UI,
  driven purely by the GPS feed it already receives.

## 6. Backend design — `v2/src-tauri/src/nav/`

### 6.1 `osrm.rs` — engine lifecycle (port of `osrm_manager.py`)
- Launch `osrm-routed --algorithm=MLD --port=5001 <region.osrm>` via
  `tauri-plugin-shell` `Command::sidecar(...)`.
- Readiness poll: GET `http://127.0.0.1:5001/` up to ~15 s; surface running state.
- Graph location: app data dir `nav/<region>/region.osrm*` (installed via download). **No** on-device
  graph processing.
- State: `OsrmManager { running, active_region, port }` in Tauri managed state; emits `nav:status`.

### 6.2 `router.rs` — route calculation (port of `router.py`)
- Request (via `reqwest`, already a dep):
  `GET /route/v1/driving/{fromLon},{fromLat};{toLon},{toLat}`
  `?steps=true&geometries=geojson&overview=full&annotations=duration,distance,maxspeed`
  `[&bearings={heading},{range};]`
- **Speed-adaptive bearing range** (`_bearing_range`): `<2 m/s → 180°`,
  `2–25 m/s → 90 − (v−2)·(60/23)`, `>25 m/s → 30°`. Applied to waypoint 0 only.
- Fallbacks (in order): retry without `maxspeed` on a 400 mentioning maxspeed; retry without the
  bearing constraint if no route; else error.
- Parse OSRM JSON → `RouteData { geometry, distance, duration, steps[], maxspeeds[] }` with
  `maneuver { type, modifier, location, bearingBefore, bearingAfter }`; normalize maxspeed to km/h.
- serde `rename_all = "camelCase"` (matches the frontend types).

### 6.3 `geocoder.rs` — place search (port of `geocoder.py`)
- Offline: `rusqlite` FTS5 prefix query (`"<q>"*`) over the pack's `places.db`, ordered by
  `importance DESC`, then haversine distance to the user; digit-prefix street retry.
- Online fallback (when offline result empty): Nominatim
  `GET https://nominatim.openstreetmap.org/search?q=&format=json&limit=5&addressdetails=1[&viewbox&bounded=0]`,
  `User-Agent: SpeedDeck/2.0`, 5 s timeout; map `osm_type` → category.
- Returns `SearchResult { name, category, latitude, longitude, importance, distance, source }`.

### 6.4 Region packs (reuse Phase-4 download pattern)
- `nav_list_regions` / `nav_download_region` / `nav_delete_region`, progress via
  `nav:download-progress` events; packs contain `region.osrm*` + `places.db`.

### 6.5 Commands & events
| Command | Args | Returns |
|---|---|---|
| `calculate_route` | `fromLon,fromLat,toLon,toLat,heading?,speed?` | `RouteData` |
| `geocode_search` | `query, nearLat?, nearLon?` | `SearchResult[]` |
| `nav_status` | — | `NavStatus` |
| `nav_list_regions` / `nav_download_region` / `nav_delete_region` | `regionId?` | status / `()` |

Events: `nav:status`, `nav:download-progress`.

### 6.6 Configuration
- `tauri.conf.json` → `bundle.externalBin` lists the `osrm-routed` sidecar.
- A shell capability scoped to **only** that sidecar (no general shell access).
- `osrm-routed` binary supplied per target triple under `src-tauri/binaries/osrm-routed-<triple>`.

## 7. Frontend design — `v2/src/apps/maps/` + stores

- `types/navigation.ts` — `SearchResult`, `RouteManeuver`, `RouteStep`, `RouteData`.
- `lib/nav.ts` — `invoke` bindings + `listen('nav:status')` (replaces v1 WS).
- `lib/nav-utils.ts` — **ported verbatim** (pure, unit-tested): `pointToSegmentDistance`,
  `findNearestRoutePoint`, `distanceAlongCoordsFromProjection`, `computeBearing`,
  `angleDifference`, `speedAdaptiveThreshold`, `hdopFactor`, `computeOffRouteScore`
  (score > 0.7 ⇒ off-route), `maneuverIcon`, `maneuverInstruction`.
- `stores/navigation-store.ts` — route/steps/`activeStepIndex`, `buildStepCoordRanges`,
  `updatePosition` (windowed nearest-point projection → step advance → distance-to-maneuver →
  off-route score → pace-factor ETA after 100 m / 30 s), status `idle|previewing|navigating`.
- `hooks/useNavigation.ts` — subscribe to **`vehicle:state`**: while navigating call
  `updatePosition`; on off-route, fire a speed-adaptive delayed reroute (≈1.5–4 s) with exponential
  backoff via `calculate_route` (passing heading + speed).
- Components (rendered over `MapsApp`): `SearchOverlay` (from/to + geocode), `RoutePreview`
  (summary + Go), `TurnBanner` (next maneuver icon + distance + instruction), `NavStatusBar`
  (ETA / remaining / speed-limit / End), and a routing-pack download overlay (reuse Phase-4 UI).
- `LiveMap.tsx` — add `route` source + `route-outline`/`route-line` layers (port v1 paint).

## 8. Off-device build tooling — `v2/scripts/`

- `build-osrm-graph.sh` — per region: `osrm-extract -p car.lua` → `osrm-partition` →
  `osrm-customize`, run through the `osrm/osrm-backend` Docker image (no local OSRM install needed),
  emitting `region.osrm*` into a downloadable pack.
- `build-places-db.sh` — reuse v1's `geocoder.build_geocoder_index` (Python: osmium + OpenAddresses)
  to produce `places.db` per region.
- Document obtaining `osrm-routed` for `x86_64-unknown-linux-gnu` (Steam Deck) from the same image.
- Extend `src-tauri/resources/map/regions.json` with `graphPackUrl` / `placesDbUrl` / sizes.

## 9. Testing & verification

**In this environment (headless, no WebKitGTK/OSRM):**
- Unit-test `nav-utils` math (off-route scoring across speed/HDOP, projection distance, bearing,
  angle wrap, pace-factor ETA) — JS test runner or a Rust port in the scratch logic crate.
- Unit-test the pure Rust pieces: bearing-range formula, OSRM-JSON → `RouteData` mapping, maxspeed
  normalization, Nominatim response mapping (against fixture JSON).
- `npm run build`; screenshot `SearchOverlay`, `RoutePreview`, `TurnBanner`, `NavStatusBar`.

**On the Deck / dev machine (full stack):**
- Install the WA pack; `SPEEDDECK_SIMULATOR=1 cargo tauri dev`.
- Search a destination → route renders; simulated drive advances maneuvers and ETA; deviating from
  the route triggers a reroute — all with networking disabled.

## 10. Work breakdown

1. **6a-1** `nav/osrm.rs` sidecar lifecycle + `nav_status` + config/capability.
2. **6a-2** `nav/router.rs` + route parsing tests.
3. **6a-3** `nav/geocoder.rs` (FTS5 + Nominatim) + mapping tests.
4. **6a-4** region-pack download commands/events.
5. **6b-1** `nav-utils.ts` + tests; `types`, `lib/nav.ts`.
6. **6b-2** `navigation-store.ts` + `useNavigation.ts`.
7. **6b-3** components + `LiveMap` route layers; integrate into Maps.
8. **6c** build scripts + `regions.json` extension + README.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| OSRM graph size | In-app download (not bundled); show size before download. |
| Sidecar binary per-arch | Build off-device via Docker; capability scoped to the sidecar only. |
| WebKitGTK route/glyph rendering | Shares the Phase-4 on-device validation step. |
| End-to-end routing unverifiable in CI | Maximize pure-logic unit tests; clear on-device test script. |
| OSRM removal desired later | `nav/` seam allows a pure-Rust router (`fast_paths`) drop-in. |

## 12. Acceptance criteria

- Offline destination search returns ranked results (online fallback when empty + connected).
- A calculated route renders on the map with a correct summary and turn list.
- During a simulated drive: the turn banner, distance-to-turn, ETA, and remaining distance update;
  the active step advances; leaving the route triggers a single, timely reroute.
- A region pack installs via in-app download and the whole flow works with networking disabled.
