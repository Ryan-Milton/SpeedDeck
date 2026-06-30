import type { CSSProperties, ReactNode } from "react";

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
      className={["hud-card", className].filter(Boolean).join(" ")}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
