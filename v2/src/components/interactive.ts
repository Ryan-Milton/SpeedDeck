import type { HTMLAttributes } from "react";

/**
 * Props that make a clickable non-button element (Card, HudPanel) behave like
 * a real button: keyboard activation, focusability, and a role. Same pattern
 * ListRow uses. Returns {} when there is no click handler.
 */
export function pressableProps(
  onClick?: () => void
): Pick<HTMLAttributes<HTMLElement>, "role" | "tabIndex" | "onClick" | "onKeyDown"> {
  if (!onClick) return {};
  return {
    role: "button",
    tabIndex: 0,
    onClick,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    },
  };
}
