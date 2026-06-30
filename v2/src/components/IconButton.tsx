import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Circular icon button. `on` = toggled/active, `size="lg"` for the play button. */
export function IconButton({
  size,
  on,
  className,
  children,
  ...rest
}: { size?: "lg"; on?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["icon-btn", size === "lg" ? "lg" : "", on ? "on" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
