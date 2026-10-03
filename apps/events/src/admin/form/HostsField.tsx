"use client";

import { useId, useState } from "react";
import { Avatar, Button, TextField } from "@didit-events/ui";
import { HostEmailField } from "./HostEmailField";
import s from "./EventForm.module.css";

export type Host = { name: string; role: string; photoUrl?: string; email?: string };

export const HOSTS_MAX = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The editor avatar for a host: the account photo (staff route) once the email is a full address, else initials. */
export const hostAvatarSrc = (email?: string) => (email && EMAIL.test(email) ? `/api/admin/hosts/photo?email=${encodeURIComponent(email.trim().toLowerCase())}` : undefined);

export interface HostsFieldProps {
  value: Host[];
  onChange: (next: Host[]) => void;
  readOnly?: boolean;
}

/**
 * Hosts: one row per host on a fixed grid (avatar, Name, Role, Account email, row tools), equal control heights and
 * gaps; rows stack below 640px. The account email autocompletes (staff and accounts) and shows that account's photo
 * here and on the public page; it is never shown to guests. Rows can be added, removed and reordered.
 */
export function HostsField({ value, onChange, readOnly }: HostsFieldProps) {
  const ids = useId();
  // Stable row keys across reorder/remove, so focus and the email suggestions stay with their host.
  const [rowKeys, setRowKeys] = useState(() => ({ keys: value.map((_, i) => i), next: value.length }));
  if (rowKeys.keys.length !== value.length) {
    const keys = value.map((_, i) => rowKeys.keys[i] ?? rowKeys.next + i);
    setRowKeys({ keys, next: Math.max(rowKeys.next, ...keys.map((k) => k + 1)) });
  }
  const keys = rowKeys.keys;
  const setKeys = (k: number[]) => setRowKeys((r) => ({ keys: k, next: Math.max(r.next, ...k.map((x) => x + 1)) }));
  // The photo is looked up for the email as committed (blur or pick), not on every keystroke.
  const [photoEmails, setPhotoEmails] = useState<Record<number, string | undefined>>({});
  // Photos that loaded: the avatar switches from initials only then (no broken image, no layout shift).
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  const update = (i: number, h: Host) => onChange(value.map((x, j) => (j === i ? h : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    const v = [...value], k = [...keys];
    [v[i], v[j]] = [v[j]!, v[i]!];
    [k[i], k[j]] = [k[j]!, k[i]!];
    setKeys(k);
    onChange(v);
  };
  const remove = (i: number) => {
    setKeys(keys.filter((_, j) => j !== i));
    onChange(value.filter((_, j) => j !== i));
  };
  const add = () => {
    setKeys([...keys, rowKeys.next]);
    onChange([...value, { name: "", role: "" }]);
  };

  return (
    <fieldset className={s.hosts} aria-labelledby={`${ids}-h`}>
      <div className={s.fieldHead}>
        <legend id={`${ids}-h`} className={s.label}>
          Hosts<span className={s.opt}> · optional</span>
        </legend>
        <span className={s.hint}>Shown on the event page. The account email shows that person’s profile photo; guests never see the email.</span>
      </div>
      {value.length ? (
        <ol className={s.hostList}>
          {value.map((host, i) => {
            const key = keys[i] ?? i;
            const label = host.name.trim() || `Host ${i + 1}`;
            const committed = key in photoEmails ? photoEmails[key] : host.email;
            const src = hostAvatarSrc(committed);
            return (
              <li key={key} className={s.hostRow} data-host-row={i}>
                <span className={s.hostAvatar} data-photo={src && loaded[src] ? "" : undefined}>
                  <Avatar name={host.name} email={host.email} src={src && loaded[src] ? src : undefined} size={32} />
                  {/* eslint-disable-next-line @next/next/no-img-element -- probe: a 404 (no account or no photo) keeps the initials */}
                  {src && loaded[src] === undefined ? <img src={src} alt="" hidden onLoad={() => setLoaded((l) => ({ ...l, [src]: true }))} onError={() => setLoaded((l) => ({ ...l, [src]: false }))} /> : null}
                </span>
                <TextField label="Name" value={host.name} readOnly={readOnly} placeholder="e.g. Alberto Rosas" maxLength={200} onChange={(e) => update(i, { ...host, name: e.target.value })} />
                <TextField label="Role" value={host.role} readOnly={readOnly} placeholder="e.g. Didit · CEO" maxLength={200} onChange={(e) => update(i, { ...host, role: e.target.value })} />
                <div className={s.hostEmail} onBlur={() => setPhotoEmails((p) => ({ ...p, [key]: host.email }))}>
                  <HostEmailField
                    value={host.email ?? ""}
                    disabled={readOnly}
                    onChange={(email) => {
                      const { email: _old, ...rest } = host;
                      update(i, email.trim() ? { ...rest, email: email.trim().toLowerCase() } : rest);
                    }}
                    onPick={(person) => {
                      setPhotoEmails((p) => ({ ...p, [key]: person.email }));
                      update(i, { ...host, email: person.email, ...(!host.name.trim() && person.name ? { name: person.name } : {}) });
                    }}
                  />
                </div>
                <div className={s.hostTools}>
                  <button type="button" className={s.iconBtn} aria-label={`Move ${label} up`} disabled={readOnly || i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className={s.iconBtn} aria-label={`Move ${label} down`} disabled={readOnly || i === value.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button type="button" className={s.iconBtn} aria-label={`Remove ${label}`} disabled={readOnly} onClick={() => remove(i)}>
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      <Button type="button" variant="secondary" size="sm" className={s.addHost} disabled={readOnly || value.length >= HOSTS_MAX} onClick={add}>
        Add host
      </Button>
    </fieldset>
  );
}
