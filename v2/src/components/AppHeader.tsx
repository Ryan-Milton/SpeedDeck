import type { ReactNode } from "react";

/** Shared screen header: display-type title + optional trailing action slot. */
export function AppHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <header className="app-header">
      <h2>{title}</h2>
      {trailing && <div className="app-header-trailing">{trailing}</div>}
    </header>
  );
}
