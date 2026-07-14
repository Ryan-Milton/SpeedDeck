import type { CSSProperties, ReactNode } from "react";
import { pressableProps } from "./interactive";

export function Card({
  className,
  style,
  onClick,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={["hud-card", onClick ? "tappable" : "", className].filter(Boolean).join(" ")}
      style={style}
      {...pressableProps(onClick)}
    >
      {children}
    </div>
  );
}
