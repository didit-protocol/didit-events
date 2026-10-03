import type { ReactNode } from "react";
import s from "./System.module.css";

export interface SystemMessageProps {
  /** "404", "403", "500 · req_3f9a21". */
  code: string;
  title: string;
  help: ReactNode;
  action: ReactNode;
  role?: "alert";
}

/** A-13a/b/c: the centred code, 36px title, help line and one action, filling the admin page column. */
export function SystemMessage({ code, title, help, action, role }: SystemMessageProps) {
  return (
    <main className={s.message} role={role}>
      <span className={s.code}>{code}</span>
      <h1 className={s.title}>{title}</h1>
      <p className={s.help}>{help}</p>
      <div className={s.action}>{action}</div>
    </main>
  );
}
