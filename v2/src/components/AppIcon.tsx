import { forwardRef } from "react";
import type { AppMeta } from "../apps/registry";

interface AppIconProps {
  app: AppMeta;
  size?: number;
  /** The surfaced app (cyan ring). */
  current?: boolean;
  /** Keyboard/controller focus (cyan glow). */
  focused?: boolean;
  showLabel?: boolean;
  onClick?: () => void;
}

/** App tile shared by the dock and Launchpad. */
export const AppIcon = forwardRef<HTMLButtonElement, AppIconProps>(function AppIcon(
  { app, size = 64, current, focused, showLabel, onClick },
  ref
) {
  const disabled = !app.enabled;
  const cls = [
    "app-tile",
    current ? "current" : "",
    focused ? "focused" : "",
    disabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      className={cls}
      onClick={() => !disabled && onClick?.()}
      disabled={disabled}
      aria-label={app.label}
      aria-current={current ? "true" : undefined}
    >
      <span
        className="tile-glyph"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(160deg, ${app.gradient[0]}, ${app.gradient[1]})`,
        }}
      >
        <app.Icon size={Math.round(size * 0.46)} />
      </span>
      {showLabel && <span className="tile-label">{app.label}</span>}
    </button>
  );
});
