import { Checkbox } from "@didit-events/ui";
import { accountLinks } from "../links";
import s from "./Screen.module.css";

/** "If approved, Didit will verify my identity…" (04 R-01 links Privacy; 05 U-14 links Privacy · Terms). */
export function Consent({ id, terms, invalid, defaultChecked, checked, onChange, disabled }: {
  id: string;
  terms?: boolean;
  invalid?: boolean;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={s.consent}>
      <Checkbox
        id={id}
        name="consent"
        size="lg"
        invalid={invalid}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        checked={checked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        disabled={disabled}
        required
      />
      <span>
        <label htmlFor={id}>I agree to prepare my Didit face check after confirming my email and to share my profile and verification results with hosts when I request an event.</label>{" "}
        <a href={accountLinks.privacy()}>Privacy</a>
        {terms ? (
          <>
            {" · "}
            <a href={accountLinks.terms()}>Terms</a>
          </>
        ) : null}
      </span>
    </div>
  );
}
