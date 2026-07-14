import { useUiStore } from "../stores/ui-store";

/** Renders the toast queue above the dock. Mount once, in the Shell. */
export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}
