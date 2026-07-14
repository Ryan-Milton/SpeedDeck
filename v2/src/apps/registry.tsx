// The CarPlay app catalog: drives the home grid, the dock, and routing.

import type { ComponentType } from "react";
import type { AppId } from "../stores/shell-store";
import {
  MapsIcon,
  MusicIcon,
  DashboardIcon,
  PhoneIcon,
  NowPlayingIcon,
  TripsIcon,
  SettingsIcon,
} from "./icons";
import MapsApp from "./maps/MapsApp";
import MusicApp from "./music/MusicApp";
import NowPlayingApp from "./music/NowPlayingApp";
import DashboardApp from "./dashboard/DashboardApp";
import TripsApp from "./trips/TripsApp";
import SettingsApp from "./settings/SettingsApp";
import ComingSoon from "./ComingSoon";

export interface AppMeta {
  id: AppId;
  label: string;
  /** CSS gradient stops for the icon tile (graphite glass; glyphs carry the
   *  identity — per-app hues broke the phosphor-cyan HUD palette). */
  gradient: [string, string];
  Icon: ComponentType<{ size?: number }>;
  Screen: ComponentType;
  /** Pinned into the floating dock (fixed order — stable driving targets). */
  inDock: boolean;
  /** Deferred surfaces render but are visually disabled on the grid. */
  enabled: boolean;
}

// One graphite tile for every app — the glyph, not the tile color, is the badge.
const GLASS: [string, string] = ["#232b36", "#12171f"];

function PhoneApp() {
  return <ComingSoon title="Phone" phase="Deferred — added with a phone/VoIP link in a later phase" />;
}

export const APPS: AppMeta[] = [
  {
    id: "maps",
    label: "Maps",
    gradient: GLASS,
    Icon: MapsIcon,
    Screen: MapsApp,
    inDock: true,
    enabled: true,
  },
  {
    id: "nowplaying",
    label: "Now Playing",
    gradient: GLASS,
    Icon: NowPlayingIcon,
    Screen: NowPlayingApp,
    inDock: true,
    enabled: true,
  },
  {
    id: "music",
    label: "Music",
    gradient: GLASS,
    Icon: MusicIcon,
    Screen: MusicApp,
    inDock: false,
    enabled: true,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    gradient: GLASS,
    Icon: DashboardIcon,
    Screen: DashboardApp,
    inDock: true,
    enabled: true,
  },
  {
    id: "trips",
    label: "Trips",
    gradient: GLASS,
    Icon: TripsIcon,
    Screen: TripsApp,
    inDock: false,
    enabled: true,
  },
  {
    id: "phone",
    label: "Phone",
    gradient: GLASS,
    Icon: PhoneIcon,
    Screen: PhoneApp,
    inDock: false,
    enabled: false,
  },
  {
    id: "settings",
    label: "Settings",
    gradient: GLASS,
    Icon: SettingsIcon,
    Screen: SettingsApp,
    inDock: false,
    enabled: true,
  },
];

export const APP_BY_ID: Record<AppId, AppMeta> = Object.fromEntries(
  APPS.map((a) => [a.id, a])
) as Record<AppId, AppMeta>;
