/** Small cyan loading spinner. */
export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      className="hud-spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}
