import type { ReactNode } from "react";

/** Centered empty/zero state: icon + headline + subcopy + optional action. */
export function EmptyState({
  icon,
  title,
  sub,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["empty-state", className].filter(Boolean).join(" ")}>
      {icon && <div className="es-icon">{icon}</div>}
      <div className="es-title">{title}</div>
      {sub && <div className="es-sub">{sub}</div>}
      {action}
    </div>
  );
}
