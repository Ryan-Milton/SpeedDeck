// Renders a CarPlay-style maneuver arrow from an OSRM maneuver type/modifier.
// Original glyphs (an up-arrow rotated by turn angle; special-cases depart/arrive).

const ANGLE: Record<string, number> = {
  "slight left": -45,
  left: -90,
  "sharp left": -135,
  "slight right": 45,
  right: 90,
  "sharp right": 135,
  uturn: 180,
  straight: 0,
};

export default function ManeuverArrow({
  type,
  modifier,
  size = 40,
}: {
  type: string;
  modifier?: string;
  size?: number;
}) {
  if (type === "arrive") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="white" stroke="none">
        <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" />
        <circle cx="12" cy="9" r="2.5" fill="#0a84ff" />
      </svg>
    );
  }
  const angle = type === "depart" ? 0 : ANGLE[modifier ?? "straight"] ?? 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="white"
      stroke="none"
      style={{ transform: `rotate(${angle}deg)` }}
    >
      <path d="M12 3l6 7h-4v11h-4V10H6z" />
    </svg>
  );
}
