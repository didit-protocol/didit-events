import { ROLE_LABEL } from "./labels";
import { ROLE_CAN, ROLE_ORDER, ROLE_SUMMARY } from "./roles";
import s from "./Team.module.css";

/** A-19 "What each role can do": one compact card per role, under the invite row. */
export function RoleGuide() {
  return (
    <section aria-labelledby="team-role-guide" className={s.roles}>
      <h2 id="team-role-guide" className={s.rolesTitle}>
        What each role can do
      </h2>
      <ul className={s.roleCards}>
        {ROLE_ORDER.map((role) => (
          <li key={role} className={s.roleCard}>
            <span className={s.roleName}>{ROLE_LABEL[role]}</span>
            <span className={s.roleSummary}>{ROLE_SUMMARY[role]}</span>
            <ul className={s.roleList}>
              {ROLE_CAN[role].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
