"use client";

import { useEffect, useId, useState } from "react";
import { TextField } from "@didit-events/ui";
import { staffEmailPlaceholder } from "../team/domain";
import s from "./EventForm.module.css";

type Person = { email: string; name: string; hasPhoto: boolean };

/**
 * Host picker: type an email or a name, pick a staff member or account (their profile photo then shows on the public
 * page), or leave it empty for a free-text host. Suggestions come from GET /api/admin/people (staff only).
 */
export function HostEmailField({ value, disabled, onChange, onPick }: { value: string; disabled?: boolean; onChange: (email: string) => void; onPick: (person: Person) => void }) {
  const listId = useId();
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/admin/people?q=${encodeURIComponent(q)}`, { credentials: "same-origin", signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { ok?: boolean; data?: Person[] } | null) => { if (body?.ok && Array.isArray(body.data)) setPeople(body.data); })
        .catch(() => undefined);
    }, 200);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [value]);
  return (
    <>
      <TextField
        label={<>Account email<span className={s.opt}> · optional</span></>}
        type="email"
        list={listId}
        autoComplete="off"
        placeholder={staffEmailPlaceholder()}
        value={value}
        readOnly={disabled}
        onChange={(e) => {
          const email = e.target.value;
          onChange(email);
          const hit = people.find((p) => p.email === email.trim().toLowerCase());
          if (hit) onPick(hit);
        }}
      />
      <datalist id={listId}>
        {people.map((p) => <option key={p.email} value={p.email}>{p.name ? `${p.name}${p.hasPhoto ? " · photo" : ""}` : p.email}</option>)}
      </datalist>
    </>
  );
}
