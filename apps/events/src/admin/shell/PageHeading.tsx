import type { ReactNode } from "react";
import s from "./PageHeading.module.css";

/** "DIDIT EVENTS" eyebrow + 28px title, with actions on the right (A-02, A-12). */
export function PageHeading({ eyebrow = "Didit Events", title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.head}>
      <div className={s.text}>
        <span className={s.eyebrow}>{eyebrow}</span>
        <h1 className={s.title}>{title}</h1>
        {description ? <p className={s.description}>{description}</p> : null}
      </div>
      {actions ? <div className={s.actions}>{actions}</div> : null}
    </div>
  );
}
