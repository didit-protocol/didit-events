import styles from "./Spinner.module.css";

/**
 * The inline loading mark (buttons, toasts, table rows): the Didit mark's ring in the text colour, drawn in CSS so
 * every button carries no extra script. MarkLoader is the same ring in the brand gradient for full-step loading.
 */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <span aria-hidden="true" className={className ? `${styles.spinner} ${className}` : styles.spinner} style={{ width: (size * 22) / 28, height: size }} />;
}
