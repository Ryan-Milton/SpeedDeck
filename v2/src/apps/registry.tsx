// The CarPlay app catalog: drives the home grid, the dock, and routing.

import type { ComponentType } from "react";
import type { AppId } from "../stores/shell-store";
import {
  MapsIcon,
  MusicIcon,
  DashboardIcon,
  PhoneIcon,
  NowPlayingIcon,
  SettingsIcon,
} from "./icons";
import MapsApp from "./maps/MapsApp";
import MusicApp from "./music/MusicApp";
import DashboardApp from "./dashboard/DashboardApp";
import SettingsApp from "./settings/SettingsApp";
import ComingSoon from "./ComingSoon";

export interface AppMeta {
  id: AppId;
  label: string;
  /** CSS gradient stops for the icon tile (CarPlay-style). */
  gradient: [string, string];
  Icon: ComponentType<{ size?: number }>;
  Screen: ComponentType;
  /** Show a shortcut in the left dock. */
  inDock: boolean;
  /** Deferred surfaces render but are visually disabled on the grid. */
  enabled: boolean;
}

function PhoneApp() {
  return <ComingSoon title="Phone" phase="Deferred — added with a phone/VoIP link in a later phase" />;
}

export const APPS: AppMeta[] = [
  {
    id: "maps",
    label: "Maps",
    gradient: ["#34c759", "#248a3d"],
    Icon: MapsIcon,
    Screen: MapsApp,
    inDock: true,
    enabled: true,
  },
  {
    id: "nowplaying",
    label: "Now Playing",
    gradient: ["#ff9f0a", "#ff6b00"],
    Icon: NowPlayingIcon,
    Screen: MusicApp,
    inDock: true,
    enabled: true,
  },
  {
    id: "music",
    label: "Music",
    gradient: ["#fa2d48", "#c70026"],
    Icon: MusicIcon,
    Screen: MusicApp,
    inDock: false,
    enabled: true,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    gradient: ["#0a84ff", "#0040dd"],
    Icon: DashboardIcon,
    Screen: DashboardApp,
    inDock: false,
    enabled: true,
  },
  {
    id: "phone",
    label: "Phone",
    gradient: ["#30d158", "#1f9e3e"],
    Icon: PhoneIcon,
    Screen: PhoneApp,
    inDock: true,
    enabled: false,
  },
  {
    id: "settings",
    label: "Settings",
    gradient: ["#8e8e93", "#5b5b60"],
    Icon: SettingsIcon,
    Screen: SettingsApp,
    inDock: false,
    enabled: true,
  },
];

export const APP_BY_ID: Record<AppId, AppMeta> = Object.fromEntries(
  APPS.map((a) => [a.id, a])
) as Record<AppId, AppMeta>;
