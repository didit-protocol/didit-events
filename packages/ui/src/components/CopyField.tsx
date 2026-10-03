"use client";

import { useEffect, useState } from "react";
import { cx } from "../cx";
import styles from "./CopyField.module.css";

export interface CopyFieldProps {
  value: string;
  /** Text shown in the field (e.g. a shortened URL); defaults to value. */
  display?: string;
  label: string;
  copyLabel?: string;
  copiedLabel?: string;
  /** Forces the copied state (frame gallery / docs). */
  copied?: boolean;
  onCopy?: (value: string) => void;
  className?: string;
}

/** Read-only value with a Copy button; announces "Copied" politely. */
export function CopyField({ value, display, label, copyLabel = "Copy", copiedLabel = "Copied", copied: forced, onCopy, className }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const isCopied = forced ?? copied;
  return (
    <div className={cx(styles.field, className)} role="group" aria-label={label}>
      <span className={styles.value} title={value}>
        <span>{display ?? value}</span>
      </span>
      <button
        type="button"
        className={cx(styles.copy, isCopied && styles.copied)}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            onCopy?.(value);
          } catch {
            setCopied(false);
          }
        }}
      >
        {isCopied ? `✓ ${copiedLabel}` : copyLabel}
      </button>
      <span className={styles.sr} aria-live="polite">
        {isCopied ? copiedLabel : ""}
      </span>
    </div>
  );
}
