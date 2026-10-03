import { cx } from "../cx";
import { EmailFrame } from "./EmailFrame";
import styles from "./EmailPreview.module.css";

export interface EmailPreviewProps {
  /** Sets `data-screen-label` (the frame gallery's pixel-gate hook). */
  label?: string;
  from: { name: string; address: string };
  /** Design annotation shown after the sender ("trigger: R-08 request submitted"). */
  trigger?: string;
  subject: string;
  preheader: string;
  /** The rendered email document. */
  html: string;
  /** desktop = 680 panel around a 600px email; mobile = 390 edge to edge. */
  size?: "desktop" | "mobile";
  initialHeight?: number;
  className?: string;
}

/** An email as an inbox shows it: sender, subject and preheader above the sandboxed email document. */
export function EmailPreview({ label, from, trigger, subject, preheader, html, size = "desktop", initialHeight, className }: EmailPreviewProps) {
  return (
    <div data-screen-label={label} className={cx(styles.panel, styles[size], className)}>
      <div className={styles.head}>
        <span>
          <b className={styles.from}>{from.name}</b> &lt;{from.address}&gt;
          {trigger ? <span className={styles.trigger}> · trigger: {trigger}</span> : null}
        </span>
        <span className={styles.subject}>{subject}</span>
        <span className={styles.preheader}>{preheader}</span>
      </div>
      <EmailFrame html={html} title={`Email preview: ${subject}`} initialHeight={initialHeight} />
    </div>
  );
}
