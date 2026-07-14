// Shared display formatting (units.ts stays conversion-only).

/** mm:ss from milliseconds; empty string for missing values (0 → "0:00"). */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
