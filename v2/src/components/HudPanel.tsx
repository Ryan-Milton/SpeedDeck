import type { CSSProperties, ReactNode } from "react";
import { pressableProps } from "./interactive";

/** A surface panel with optional cyan corner brackets and active glow. */
export function HudPanel({
  active,
  brackets = true,
  className,
  style,
  onClick,
  ariaLabel,
  children,
}: {
  active?: boolean;
  brackets?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={["hud-panel", active ? "active" : "", onClick ? "tappable" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      aria-label={ariaLabel}
      {...pressableProps(onClick)}
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
