import type { CSSProperties, ReactNode } from "react";

/** Wraps children in cyan game-HUD corner brackets. `active` lights them up. */
export function HudFrame({
  active,
  className,
  style,
  children,
}: {
  active?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={["hud-frame", active ? "active" : "", className].filter(Boolean).join(" ")}
      style={style}
    >
      {children}
      <i className="hud-corner tl" />
      <i className="hud-corner tr" />
      <i className="hud-corner bl" />
      <i className="hud-corner br" />
    </div>
  );
}
