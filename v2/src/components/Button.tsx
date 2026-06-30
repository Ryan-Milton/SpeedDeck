import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  size,
  className,
  children,
  ...rest
}: { variant?: Variant; size?: "sm" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    "btn",
    variant !== "secondary" ? variant : "",
    size === "sm" ? "sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
