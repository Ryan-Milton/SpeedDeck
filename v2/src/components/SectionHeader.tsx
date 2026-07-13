import type { ReactNode } from "react";

/** Uppercase, tracked HUD section label with a trailing hairline rule. */
export function SectionHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <div className="section-header">
      <span className="sh-title">{title}</span>
      <span className="sh-rule" />
      {trailing}
    </div>
  );
}
