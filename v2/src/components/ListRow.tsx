import type { KeyboardEvent, ReactNode } from "react";

/** A row in a list. Provide label/value, or children for custom content. */
export function ListRow({
  label,
  value,
  active,
  onClick,
  className,
  children,
}: {
  label?: ReactNode;
  value?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const tappable = !!onClick;
  const cls = ["list-row", tappable ? "tappable" : "", active ? "active" : "", className]
    .filter(Boolean)
    .join(" ");
  const onKeyDown = (e: KeyboardEvent) => {
    if (tappable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick!();
    }
  };
  return (
    <div
      className={cls}
      onClick={onClick}
      onKeyDown={tappable ? onKeyDown : undefined}
      role={tappable ? "button" : undefined}
      tabIndex={tappable ? 0 : undefined}
      aria-current={active ? "true" : undefined}
    >
      {children ?? (
        <>
          <span className="row-label">{label}</span>
          <span className="row-value">{value}</span>
        </>
      )}
    </div>
  );
}

/** Static label/value row (Settings-style). */
export function SettingsRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return <ListRow label={label} value={value} />;
}
