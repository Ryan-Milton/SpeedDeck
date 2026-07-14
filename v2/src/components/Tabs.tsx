import { useRef, type KeyboardEvent } from "react";

/**
 * Segmented HUD tab control. Roving focus: the active tab is the only
 * tab stop; Arrow keys / Home / End move selection (d-pad friendly).
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  idBase,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  /** When set, tabs get ids `${idBase}-tab-<id>` and aria-controls `${idBase}-panel-<id>`. */
  idBase?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = tabs.findIndex((t) => t.id === value);

  const onKeyDown = (e: KeyboardEvent) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(tabs[next].id);
      refs.current[next]?.focus();
    }
  };

  return (
    <div className="hud-tabs" role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="tab"
          id={idBase ? `${idBase}-tab-${t.id}` : undefined}
          aria-controls={idBase ? `${idBase}-panel-${t.id}` : undefined}
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          className={["tab", value === t.id ? "active" : ""].filter(Boolean).join(" ")}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
