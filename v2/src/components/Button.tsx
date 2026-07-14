import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  size,
  loading,
  className,
  children,
  disabled,
  ...rest
}: { variant?: Variant; size?: "sm"; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    "btn",
    variant !== "secondary" ? variant : "",
    size === "sm" ? "sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}
