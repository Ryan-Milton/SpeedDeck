// Transient UI feedback (toasts). Backend/IPC failures must surface somewhere
// visible — a silent .catch(() => {}) makes a broken backend look like empty data.

import { create } from "zustand";

export type ToastKind = "info" | "ok" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface UiStore {
  toasts: Toast[];
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: number) => void;
}

const TOAST_MS = 5000;
const MAX_TOASTS = 3;
let nextId = 1;

export const useUiStore = create<UiStore>((set) => ({
  toasts: [],
  pushToast: (kind, message) =>
    set((s) => {
      // Collapse exact repeats (e.g. an IPC failing on every poll).
      if (s.toasts.some((t) => t.message === message)) return s;
      const id = nextId++;
      setTimeout(
        () => set((s2) => ({ toasts: s2.toasts.filter((t) => t.id !== id) })),
        TOAST_MS
      );
      return { toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), { id, kind, message }] };
    }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toastError = (message: string) => useUiStore.getState().pushToast("error", message);
export const toastOk = (message: string) => useUiStore.getState().pushToast("ok", message);
