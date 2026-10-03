/** A tiny external store for toasts (no context needed): `toast()` from anywhere, `<Toaster />` renders them. */
/** `progress` swaps the dot for a spinner (05 AP-08 "Approving 3 of 3…"). */
export type ToastTone = "success" | "danger" | "info" | "progress";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  /** ms before auto-dismiss; 0 keeps it until dismissed. */
  duration: number;
}

type Listener = () => void;

export function createToastStore() {
  let items: ToastItem[] = [];
  let seq = 0;
  const listeners = new Set<Listener>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const emit = () => listeners.forEach((l) => l());

  function dismiss(id: number) {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    const next = items.filter((i) => i.id !== id);
    if (next.length !== items.length) {
      items = next;
      emit();
    }
  }

  function show(input: { message: string; tone?: ToastTone; action?: ToastAction; duration?: number }): number {
    const id = ++seq;
    const item: ToastItem = { id, message: input.message, tone: input.tone ?? "success", action: input.action, duration: input.duration ?? (input.action ? 6000 : 4000) };
    items = [...items, item].slice(-4);
    if (item.duration > 0) timers.set(id, setTimeout(() => dismiss(id), item.duration));
    emit();
    return id;
  }

  return {
    show,
    dismiss,
    clear() {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      items = [];
      emit();
    },
    getSnapshot: () => items,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type ToastStore = ReturnType<typeof createToastStore>;

const EMPTY: ToastItem[] = [];
export const getServerSnapshot = () => EMPTY;

/** The app-wide store. */
export const toasts = createToastStore();
export const toast = toasts.show;
