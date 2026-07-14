import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";

/**
 * In-HUD modal dialog: glass scrim, focus trap, Escape/scrim-tap close.
 * Use ConfirmDialog for destructive actions and PromptDialog instead of
 * window.prompt (native modals don't belong on a car screen).
 */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current!;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = (i + (e.shiftKey ? -1 : 1) + items.length) % items.length;
        e.preventDefault();
        items[next].focus();
      }
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-scrim" onClick={onClose}>
      <div
        ref={panelRef}
        className="hud-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

/** Two-button confirmation. `danger` styles the confirm as destructive. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog title={title} onClose={onCancel}>
      {body && <p className="dialog-body">{body}</p>}
      <div className="dialog-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/** Single-field text input dialog (window.prompt replacement). */
export function PromptDialog({
  title,
  initial = "",
  placeholder,
  confirmLabel = "Save",
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = () => {
    const v = text.trim();
    if (v) onSubmit(v);
  };
  return (
    <Dialog title={title} onClose={onCancel}>
      <input
        className="dialog-input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <div className="dialog-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!text.trim()} onClick={submit}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
