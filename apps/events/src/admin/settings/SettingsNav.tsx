"use client";

import { useEffect, useState } from "react";
import s from "./Settings.module.css";

export interface SettingsSection {
  id: string;
  label: string;
  danger?: boolean;
}

/** The section list: `aria-current` follows the URL hash (and the first section when there is none). */
export function SettingsNav({ sections }: { sections: readonly SettingsSection[] }) {
  const [current, setCurrent] = useState(sections[0]?.id);
  useEffect(() => {
    const sync = () => {
      const id = window.location.hash.slice(1);
      setCurrent(sections.some((sec) => sec.id === id) ? id : sections[0]?.id);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [sections]);
  return (
    <nav className={s.nav} aria-label="Settings sections">
      {sections.map((sec) => (
        <a key={sec.id} href={`#${sec.id}`} aria-current={sec.id === current ? "true" : undefined} className={sec.danger ? s.navDanger : undefined}>
          {sec.label}
        </a>
      ))}
    </nav>
  );
}
