import type { ReactNode } from "react";

export function Badge({
  variant,
  children,
}: {
  variant?: "ok" | "alert";
  children: ReactNode;
}) {
  return <span className={["badge", variant].filter(Boolean).join(" ")}>{children}</span>;
}
