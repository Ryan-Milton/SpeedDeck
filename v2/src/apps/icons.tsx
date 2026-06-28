// Simple original SVG glyphs for the app tiles (white on the tile's gradient).
// Pixel-faithful Apple icons are user-supplied assets dropped in later; these
// keep the layout honest and recognizable in the meantime.

type IconProps = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "white",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function MapsIcon({ size = 30 }: IconProps) {
  return (
    <svg {...base(size)} fill="white" stroke="none">
      <path d="M12 2 4 21l8-4 8 4z" />
    </svg>
  );
}

export function MusicIcon({ size = 30 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 18V5l10-2v13" />
      <circle cx="6" cy="18" r="3" fill="white" stroke="none" />
      <circle cx="16" cy="16" r="3" fill="white" stroke="none" />
    </svg>
  );
}

export function DashboardIcon({ size = 30 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 14a9 9 0 0 1 18 0" />
      <path d="M12 14l4-3" />
      <circle cx="12" cy="14" r="1.2" fill="white" stroke="none" />
    </svg>
  );
}

export function PhoneIcon({ size = 30 }: IconProps) {
  return (
    <svg {...base(size)} fill="white" stroke="none">
      <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1z" />
    </svg>
  );
}

export function NowPlayingIcon({ size = 30 }: IconProps) {
  return (
    <svg {...base(size)} fill="white" stroke="none">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function SettingsIcon({ size = 30 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </svg>
  );
}
