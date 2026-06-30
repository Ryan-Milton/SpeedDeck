import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

/** A surface panel with optional cyan corner brackets and active glow. */
export function HudPanel({
  active,
  brackets = true,
  className,
  style,
  onClick,
  children,
}: {
  active?: boolean;
  brackets?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      className={["hud-panel", active ? "active" : "", className].filter(Boolean).join(" ")}
      style={style}
      onClick={onClick}
    >
      {children}
      {brackets && (
        <>
          <i className="hud-corner tl" />
          <i className="hud-corner tr" />
          <i className="hud-corner bl" />
          <i className="hud-corner br" />
        </>
      )}
    </div>
  );
}
