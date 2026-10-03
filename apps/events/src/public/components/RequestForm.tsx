"use client";

import { CsrfField } from "../../auth/CsrfField";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Banner, EmailField, StatusIcon, SubmitButton, TextField } from "@didit-events/ui";
import { REQUEST_FIELDS, errorSummary } from "../request";
import type { RequestFormState, RequestInput, Viewer } from "../types";
import s from "./SimpleEventPage.module.css";

export type RequestAction = (prev: RequestFormState, form: FormData) => Promise<RequestFormState>;

export interface RequestFormProps {
  slug: string;
  action: RequestAction;
  /** Starting state (frames render the design states from it). */
  initial?: RequestFormState;
  /** Forces the in-flight look (G-01c). */
  pending?: boolean;
  /** Signed-in guest: names/company/role are prefilled and the email is shown read-only (the action reads it from the session). */
  viewer?: Viewer | null;
  /** Signed-in staff without a guest session: a note says requests use a guest account. */
  staff?: { email: string } | null;
  /** "Not you? Sign out" for a signed-in guest. */
  signOut?: (form: FormData) => Promise<void>;
}

/** G-01 "Request to attend": validation errors, submitting, submitted and already-requested states. */
export function RequestForm({ slug, action, initial = { status: "idle" }, pending, viewer, staff, signOut }: RequestFormProps) {
  const [state, formAction] = useActionState(action, initial);

  if (state.status === "submitted") {
    return (
      <div className={s.submitted} role="status">
        <StatusIcon tone="success" size={44} />
        <p className={s.thanks}>{`Thanks, ${state.firstName}.`}</p>
        <p className={s.thanksBody}>We&apos;ll email you if your place is confirmed.</p>
      </div>
    );
  }

  const signOutId = `signout-${slug}`;
  return (
    <>
      <form action={formAction} className={s.form} noValidate aria-labelledby={`request-${slug}`}><CsrfField />
        <input type="hidden" name="slug" value={slug} />
        <Fields state={state} slug={slug} forcePending={pending} viewer={viewer} staff={viewer ? null : staff} signOutForm={viewer && signOut ? signOutId : undefined} />
      </form>
      {/* Forms cannot nest: the "Sign out" button inside the request form posts this one through its `form` attribute. */}
      {viewer && signOut ? (
        <form id={signOutId} action={signOut} hidden><CsrfField />
          <input type="hidden" name="slug" value={slug} />
        </form>
      ) : null}
    </>
  );
}

const fromViewer = (v: Viewer): Partial<RequestInput> => ({ firstName: v.firstName, lastName: v.lastName, company: v.company ?? "", role: v.role ?? "" });

function Fields({ state, slug, forcePending, viewer, staff, signOutForm }: { state: RequestFormState; slug: string; forcePending?: boolean; viewer?: Viewer | null; staff?: { email: string } | null; signOutForm?: string }) {
  const status = useFormStatus();
  const busy = forcePending || status.pending;
  const values: Partial<RequestInput> = "values" in state && state.values ? state.values : viewer ? fromViewer(viewer) : {};
  const errors = state.status === "invalid" ? state.errors : {};
  const errorCount = Object.keys(errors).length;
  const field = (def: (typeof REQUEST_FIELDS)[number]) => {
    const name = def.name;
    const common = {
      name,
      label: def.optional ? (
        <>
          {def.label} <span className={s.optional}>· optional</span>
        </>
      ) : (
        def.label
      ),
      size: "lg" as const,
      defaultValue: values[name] ?? "",
      error: errors[name],
      autoComplete: def.autoComplete,
      readOnly: busy,
      required: !def.optional,
    };
    if (name === "email" && viewer) {
      // Signed in: the request uses the session's email, so there is no email input to edit (or spoof).
      return (
        <p key={name} className={`${s.requestingAs} ${s.wide}`} data-requesting-as="">
          Requesting as <strong className={s.requestingEmail}>{viewer.email}</strong>
          {signOutForm ? (
            <>
              {" · Not you? "}
              <button type="submit" form={signOutForm} formNoValidate className={s.linkButton}>
                Sign out
              </button>
            </>
          ) : null}
        </p>
      );
    }
    const Control = name === "email" ? EmailField : TextField;
    return <Control key={name} {...common} placeholder={name === "email" ? "you@company.com" : undefined} className={name === "email" ? `${s.field} ${s.wide}` : s.field} />;
  };

  return (
    <>
      <h2 id={`request-${slug}`} className={s.formTitle}>
        Request to attend
      </h2>
      {/* Banners carry role="alert" / role="status", so screen readers announce them when they appear. */}
      {state.status === "invalid" && errorCount ? (
        <Banner tone="danger" className={s.banner}>
          {errorSummary(errorCount)}
        </Banner>
      ) : state.status === "already" ? (
        <Banner tone="info" className={s.banner}>
          {`You already asked to attend with ${state.email}. We’ll email you when it’s confirmed.`}
        </Banner>
      ) : state.status === "error" ? (
        <Banner tone="danger" className={s.banner}>
          {state.message}
        </Banner>
      ) : null}
      {staff ? (
        <p className={s.staffNote} role="note">
          {`You’re signed in as staff (${staff.email}). Requests use a guest account.`}
        </p>
      ) : null}
      <div className={busy ? `${s.fields} ${s.busy}` : s.fields}>{REQUEST_FIELDS.map(field)}</div>
      <p className={s.note}>Didit will verify your identity before the event to enable face check-in at the door.</p>
      <SubmitButton size="xl" block pending={forcePending} pendingLabel="Sending request…" className={s.submit}>
        Request to attend
      </SubmitButton>
    </>
  );
}
