"use client";

import { useSyncExternalStore } from "react";
import { cx } from "../cx";
import { Spinner } from "./Spinner";
import { getServerSnapshot, toasts as defaultStore, type ToastAction, type ToastStore, type ToastTone } from "./toastStore";
import styles from "./Toast.module.css";

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  action?: ToastAction;
  onDismiss?: () => void;
  className?: string;
}

/** One toast (presentational). Errors are role="alert", the rest role="status". */
export function Toast({ message, tone = "success", action, onDismiss, className }: ToastProps) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx(styles.toast, className)}>
      {tone === "progress" ? <Spinner size={12} className={styles.spin} /> : <span className={cx(styles.dot, styles[tone])} aria-hidden="true" />}
      <span>
        {message}
        {action ? (
          <>
            {" · "}
            <button type="button" className={styles.action} onClick={action.onClick}>
              {action.label}
            </button>
          </>
        ) : null}
      </span>
      {onDismiss ? (
        <button type="button" className={styles.close} aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      ) : null}
    </div>
  );
}

/** Renders the toast store in a fixed live region. Mount once per layout. */
export function Toaster({ store = defaultStore }: { store?: ToastStore }) {
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
  return (
    <ol className={styles.region} aria-label="Notifications">
      {items.map((t) => (
        <li key={t.id}>
          <Toast
            message={t.message}
            tone={t.tone}
            action={t.action ? { label: t.action.label, onClick: () => (t.action?.onClick(), store.dismiss(t.id)) } : undefined}
            onDismiss={() => store.dismiss(t.id)}
          />
        </li>
      ))}
    </ol>
  );
}
