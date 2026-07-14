import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Circular icon button. `on` = toggled/active, `size="lg"` for the play button.
 * `aria-label` is required — an icon-only control has no other accessible name.
 */
export function IconButton({
  size,
  on,
  className,
  children,
  ...rest
}: {
  size?: "lg";
  on?: boolean;
  children: ReactNode;
  "aria-label": string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["icon-btn", size === "lg" ? "lg" : "", on ? "on" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
