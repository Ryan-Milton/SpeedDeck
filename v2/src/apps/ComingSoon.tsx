// Shared placeholder for surfaces not yet implemented. Each real app replaces
// this in its phase (Maps: 4/6, Music: 7/9, etc.).

export default function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="app-screen app-placeholder">
      <h2>{title}</h2>
      <p className="muted">{phase}</p>
    </div>
  );
}
