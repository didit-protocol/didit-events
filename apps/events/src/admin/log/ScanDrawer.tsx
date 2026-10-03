"use client";

import type { ReactNode } from "react";
import { ButtonLink, Drawer, Tag, cx } from "@didit-events/ui";
import { useAdminRouter } from "../useAdminRouter";
import { FaceAvatar } from "./FaceAvatar";
import type { LogRowView } from "./helpers";
import s from "./Log.module.css";

export interface ScanDrawerProps {
  /** The formatted scan (the same row the table shows) plus its date line. */
  row: LogRowView;
  date: string;
  /** False while the panel closes (it stays mounted to leave). */
  open?: boolean;
  /** Moves the URL (close). The host keeps the panel mounted; without one it is a page navigation. */
  go?: (href: string) => void;
  /** Where "close" goes (the log with its filters). */
  closeHref: string;
  /** "Add as guest" target; null without guests.invite. */
  addHref: string | null;
  inline?: boolean;
}

/**
 * A scan with no registration (unknown face, not on the list, system outcomes): a compact panel in the guest drawer's
 * shell. Never an image: scans store no face.
 */
export function ScanDrawer({ row, date, open = true, go, closeHref, addHref, inline }: ScanDrawerProps) {
  const router = useAdminRouter();
  const close = () => (go ? go(closeHref) : router.push(closeHref, { scroll: false }));
  const facts: [string, ReactNode][] = [
    ["Time", `${date} · ${row.time}`],
    ["Door", row.door],
    ["Match", <span key="m" className={cx(row.lowMatch && s.low)}>{row.match}</span>],
    ["Outcome", <Tag key="o" tone={row.tone}>{row.result}</Tag>],
    ["Test mode", row.test ? "Yes · nobody was admitted" : "No"],
    ["Latency", row.latency],
  ];
  return (
    <Drawer
      open={open}
      inline={inline}
      onClose={close}
      className={s.sheet}
      width={520}
      contentKey={inline ? undefined : row.id}
      eyebrow="Scan"
      media={<FaceAvatar size={56} />}
      title={row.guest === "—" ? row.result : row.guest}
      titleAside={row.test ? <Tag tone="neutral">Test</Tag> : undefined}
      subtitle={`${row.door} · ${row.time}`}
      footer={
        addHref ? (
          <ButtonLink href={addHref} variant="secondary">
            Add as guest
          </ButtonLink>
        ) : undefined
      }
    >
      <dl className={s.facts}>
        {facts.map(([k, v]) => (
          <div key={k} className={s.fact}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Drawer>
  );
}
