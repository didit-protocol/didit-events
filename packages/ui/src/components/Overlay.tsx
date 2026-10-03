"use client";

import { memo, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { useFocusTrap } from "./focus";
import { usePresence } from "./motion";
import styles from "./Overlay.module.css";

interface OverlayBase {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Renders in place without scrim/portal/focus trap (frame gallery / docs). */
  inline?: boolean;
  /** Close when the scrim is clicked (default true). */
  dismissible?: boolean;
  className?: string;
}

const subscribeNothing = () => () => {};

/** document.body once hydrated on the client; null on the server and during hydration. */
function usePortalTarget(enabled: boolean) {
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return enabled && mounted ? document.body : null;
}

/** The panel as it was when it closed: while it animates out, the owner's now-empty props do not blank it. */
const Frozen = memo(
  function Frozen({ children }: { frozen: boolean; children: ReactNode }) {
    return children;
  },
  (_prev, next) => next.frozen,
);

function Layer({
  inline,
  open,
  onClose,
  dismissible = true,
  scrimClass,
  children,
}: {
  inline?: boolean;
  open: boolean;
  onClose: () => void;
  dismissible?: boolean;
  scrimClass?: string;
  children: ReactNode;
}) {
  const target = usePortalTarget(!inline);
  const scrim = useRef<HTMLDivElement>(null);
  // Closing plays the leave animation first (none in place, under reduced motion it is a fade).
  const present = usePresence(open && !inline, scrim);
  if (inline) return open ? <div className={cx(styles.scrim, styles.inline)}>{children}</div> : null;
  if (!present || !target) return null;
  return createPortal(
    <div
      ref={scrim}
      className={cx(styles.scrim, scrimClass)}
      data-leaving={open ? undefined : ""}
      onMouseDown={(e) => {
        if (open && dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <Frozen frozen={!open}>{children}</Frozen>
    </div>,
    target,
  );
}

export interface ModalProps extends OverlayBase {
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Max width in px (default 440). */
  width?: number;
  role?: "dialog" | "alertdialog";
  /** A round × next to the title (01b A-07 Add guests). */
  closeLabel?: string;
}

/** Modal dialog: focus trap, Esc closes, focus returns to the opener, page scroll locked. */
export function Modal({ open, onClose, title, description, children, footer, width, inline, dismissible, role = "dialog", closeLabel, className }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(ref, open && !inline, onClose);
  return (
    <Layer inline={inline} open={open} onClose={onClose} dismissible={dismissible && role === "dialog"}>
      <div
        ref={ref}
        role={role}
        aria-modal={inline ? undefined : true}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(styles.modal, className)}
        style={width ? ({ "--modal-w": `${width}px` } as CSSProperties) : undefined}
      >
        {closeLabel ? (
          <div className={styles.modalHead}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <Button variant="icon" size="sm" aria-label={closeLabel} onClick={onClose}>
              <Icon name="close" />
            </Button>
          </div>
        ) : (
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
        )}
        {description ? (
          <p id={descId} className={styles.body}>
            {description}
          </p>
        ) : null}
        {children}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </Layer>
  );
}

export interface ConfirmDialogProps extends Omit<OverlayBase, "dismissible"> {
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  loading?: boolean;
}

/** Confirmation (role="alertdialog"). Cancel gets initial focus so Enter never confirms by accident. */
export function ConfirmDialog({ confirmLabel, cancelLabel = "Cancel", onConfirm, destructive, loading, onClose, ...rest }: ConfirmDialogProps) {
  return (
    <Modal
      {...rest}
      onClose={onClose}
      role="alertdialog"
      width={360}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} data-autofocus="">
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} size="sm" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export interface DrawerProps extends OverlayBase {
  children?: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  closeLabel?: string;
  /** Stacked header (A-06): a small uppercase line with the close button, then the title, then `subtitle`. */
  eyebrow?: ReactNode;
  /** Next to the title in the stacked header (a status pill). */
  titleAside?: ReactNode;
  subtitle?: ReactNode;
  /** Stacked header: shown left of the title + subtitle (05 AP-03: the 48px applicant avatar). */
  media?: ReactNode;
  /** Stacked header: a last row under the title block (05 AP-04: the returning-guest banner). */
  headerFooter?: ReactNode;
  /** Width in px (default 480; 05 AP-03 is 520). */
  width?: number;
  /**
   * The record the drawer shows (an id). When it changes while the drawer is open, the same panel stays up: only the
   * title block and the body swap, with a short fade (none under reduced motion); the body scrolls back to the top and
   * focus stays in the panel. The eyebrow row (its actions, the close button) and the footer update in place.
   */
  contentKey?: string;
}

/** Right-side 480px drawer (guest details etc.): focus trap, Esc closes. */
export function Drawer({ open, onClose, title, children, footer, headerActions, closeLabel = "Close", eyebrow, titleAside, subtitle, media, headerFooter, width, contentKey, inline, dismissible, className }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open && !inline, onClose);
  // A swap is a new key on a drawer that was already open: opening (the panel slides in) never fades its content too.
  const [seen, setSeen] = useState({ key: contentKey, open });
  const [swap, setSwap] = useState(false);
  if (seen.key !== contentKey || seen.open !== open) {
    setSeen({ key: contentKey, open });
    setSwap(open && seen.open && seen.key !== contentKey);
  }
  useLayoutEffect(() => {
    if (!swap) return;
    if (body.current) body.current.scrollTop = 0;
    // The focused control may have left with the old content (a section link): keep focus inside the trap.
    if (!inline && ref.current && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true });
  }, [swap, contentKey, inline]);
  const swapping = swap ? "" : undefined;
  const titleBlock = media ? (
    <div className={styles.drawerMediaRow}>
      {media}
      <div className={styles.drawerMediaText}>
        <div className={styles.drawerTitleRow}>
          <h2 id={titleId} className={styles.drawerTitle}>
            {title}
          </h2>
          {titleAside}
        </div>
        {subtitle ? <div className={styles.drawerSubtitle}>{subtitle}</div> : null}
      </div>
    </div>
  ) : (
    <>
      <div className={styles.drawerTitleRow}>
        <h2 id={titleId} className={styles.drawerTitle}>
          {title}
        </h2>
        {titleAside}
      </div>
      {subtitle ? <div className={styles.drawerSubtitle}>{subtitle}</div> : null}
    </>
  );
  return (
    <Layer inline={inline} open={open} onClose={onClose} dismissible={dismissible} scrimClass={styles.drawerScrim}>
      <aside
        ref={ref}
        role="dialog"
        aria-modal={inline ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(styles.drawer, className)}
        style={width ? ({ "--drawer-w": `${width}px` } as CSSProperties) : undefined}
      >
        {eyebrow !== undefined ? (
          <div className={cx(styles.drawerHead, styles.drawerHeadStacked)}>
            <div className={styles.drawerEyebrowRow}>
              <span className={styles.drawerEyebrow}>{eyebrow}</span>
              {headerActions}
              <Button variant="icon" size="sm" aria-label={closeLabel} onClick={onClose}>
                <Icon name="close" />
              </Button>
            </div>
            {contentKey === undefined ? (
              <>
                {titleBlock}
                {headerFooter}
              </>
            ) : (
              <div key={contentKey} className={styles.drawerSwapHead} data-swap={swapping}>
                {titleBlock}
                {headerFooter}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.drawerHead}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {headerActions}
            <Button variant="icon" size="sm" aria-label={closeLabel} onClick={onClose}>
              <Icon name="close" />
            </Button>
          </div>
        )}
        <div ref={body} className={styles.drawerBody}>
          {contentKey === undefined ? (
            children
          ) : (
            <div key={contentKey} className={styles.drawerSwap} data-swap={swapping}>
              {children}
            </div>
          )}
        </div>
        {footer ? <div className={styles.drawerFoot}>{footer}</div> : null}
      </aside>
    </Layer>
  );
}
