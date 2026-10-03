"use client";

import { errorCopy } from "../api-client";
import { useEffect,useId,useRef,useState,type FormEvent } from "react";
import { Button,Checkbox,TextField,cx } from "@didit-events/ui";
import type { OnboardingApi } from "../onboarding-api";
import { PROFILE_LIMITS,pollDelayMs,profileFormValues,profilePatch,validateProfileForm,withSingleLink,type OnboardingView,type ProfileFormField,type ProfileFormValues } from "../onboarding";
import { httpSuggestSocial,useSocialSuggestions,type SuggestSocial } from "../social-suggest";
import { EXTRA_HINTS,blocksLaunch,extraLabel,reasonCopy,requestConsent,type RequestApi,type RequestContext } from "../request-join";
import { Callout,Eyebrow,Lead,MetGlyph,RowGroup,SecuredByDidit,SheetFooter,Title,styles as s } from "./Screen";
import { StepBody } from "./join/Step";
import { SocialChips } from "./SocialChips";
import o from "./Onboarding.module.css";

const PROFILE_FIELDS: { field: "fullName" | "headline" | "company"; server: string[]; label: string; placeholder: string; autoComplete: string }[] = [
  { field: "fullName", server: ["fullName"], label: "Full name", placeholder: "e.g. María García", autoComplete: "name" },
  { field: "company", server: ["company"], label: "Company", placeholder: "e.g. Contoso, Adatum, Didit", autoComplete: "organization" },
  { field: "headline", server: ["headline", "jobRole"], label: "Role", placeholder: "e.g. Founder & CEO", autoComplete: "organization-title" },
];

/* ── Missing profile fields only ───────────────────────────────────────────────────────────────────────────── */

/**
 * Flow v3: only the required fields the account is still missing (name, company, role, one link), inline in the
 * modal. A complete profile never sees this step. `nameOnly`: just the full name (the name on the ID did not match).
 */
export function MissingProfile({ onboarding, profileApi, titleId, onSaved, onNotice, nameOnly = false, onCancel, suggestSocial = httpSuggestSocial }: { onboarding: OnboardingView; profileApi: OnboardingApi; titleId: string; onSaved: () => Promise<unknown>; onNotice: (n: string | null) => void; nameOnly?: boolean; onCancel?: () => void; suggestSocial?: SuggestSocial }) {
  const missing = new Set(nameOnly ? ["fullName"] : onboarding.missingProfileFields);
  const fields = PROFILE_FIELDS.filter((f) => f.server.some((k) => missing.has(k)));
  const askLink = missing.has("links") || [...missing].some((k) => k.startsWith("links"));
  const [values, setValues] = useState<ProfileFormValues>(() => profileFormValues(onboarding.profile));
  const [link, setLink] = useState(() => values.linkedin || values.website);
  const [errors, setErrors] = useState<Partial<Record<ProfileFormField | "links", string>>>({});
  const [saving, setSaving] = useState(false);
  // One link slot: LinkedIn chips only, and only while the guest has not typed a link.
  const social = useSocialSuggestions(values.fullName, values.company, askLink && !link.trim(), suggestSocial);
  const shown = new Set<string>([...fields.map((f) => f.field), ...(askLink ? ["linkedin", "website", "links"] : [])]);
  const set = (k: ProfileFormField) => (v: string) => {
    setValues((old) => ({ ...old, [k]: v }));
    if (errors[k]) setErrors((old) => ({ ...old, [k]: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = askLink ? withSingleLink(values, link) : values;
    const all = validateProfileForm(next);
    // The one link input carries whichever slot it filled.
    const found = Object.fromEntries(Object.entries(all).filter(([k]) => shown.has(k)).map(([k, v]) => [k === "linkedin" || k === "website" ? "links" : k, k === "website" ? "Enter a link like linkedin.com/in/yourname or https://your.site" : v]));
    // A saved field that is invalid but not shown here is the server's call: never block on what we did not ask.
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    onNotice(null);
    const res = await profileApi.saveProfile(profilePatch(next, onboarding.profileVersion));
    if (!res.ok) {
      setSaving(false);
      onNotice(res.error.code === "context_changed" ? "Your profile changed in another tab. Check it and save again." : errorCopy(res.error));
      if (res.error.code === "context_changed") await onSaved();
      return;
    }
    // Stay busy until the flow has advanced: a second tap would resend the now-stale profile version (409).
    try { await onSaved(); } finally { setSaving(false); }
  }

  const nameField = fields.find((f) => f.field === "fullName");
  const workFields = fields.filter((f) => f.field !== "fullName");
  const input = (f: (typeof PROFILE_FIELDS)[number], autoFocus: boolean) => (
    <TextField key={f.field} name={f.field} label={f.label} size="lg" autoComplete={f.autoComplete} placeholder={f.placeholder} value={values[f.field]} onChange={(e) => set(f.field)(e.target.value)} error={errors[f.field]} maxLength={PROFILE_LIMITS[f.field]} readOnly={saving} required data-autofocus={autoFocus ? "" : undefined} />
  );

  return (
    <form className={cx(s.form, s.fill)} onSubmit={submit} noValidate>
      <StepBody>
        <Title id={titleId} size={22}>
          {nameOnly ? "Update your name" : fields.length + (askLink ? 1 : 0) === 1 ? "One detail for the hosts" : "Tell the hosts who you are"}
        </Title>
        <Lead>{nameOnly ? "Write it as it appears on your ID. It is saved to your profile." : "Hosts see this when you request a place. It is saved to your account, so you only do it once."}</Lead>
        {nameField ? input(nameField, true) : null}
        {workFields.length ? <div className={o.pair}>{workFields.map((f, i) => input(f, !nameField && i === 0))}</div> : null}
        {askLink ? (
          <TextField
            name="link"
            label="LinkedIn or website"
            size="lg"
            inputMode="url"
            autoComplete="url"
            placeholder="linkedin.com/in/yourname"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              if (errors.links) setErrors((old) => ({ ...old, links: undefined }));
            }}
            error={errors.links}
            readOnly={saving}
            required
            data-autofocus={!fields.length ? "" : undefined}
          />
        ) : null}
        {askLink ? (
          <SocialChips
            loading={social.loading}
            chips={link.trim() ? [] : social.suggestions.linkedin.map((c) => ({ ...c, network: "linkedin" as const, field: "link" }))}
            disabled={saving}
            onPick={(c) => {
              setLink(c.url);
              if (errors.links) setErrors((old) => ({ ...old, links: undefined }));
            }}
          />
        ) : null}
        <p className={o.disclosure}>Hosts of the events you request see your name, role, company, link and photo. Never your selfie.{askLink ? " We may look up your public LinkedIn and X to suggest them." : ""}</p>
        <SecuredByDidit />
      </StepBody>
      <SheetFooter>
        {onCancel ? (
          <Button type="button" size="lg" block variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="xl" block loading={saving}>
          {saving ? "Saving…" : nameOnly ? "Save name" : "Continue"}
        </Button>
      </SheetFooter>
    </form>
  );
}

/* ── Event extras (phone / ID / age) ───────────────────────────────────────────────────────────────────────── */

export function Extras({ ctx, api, titleId, go, onContext, onNotice, onFixName }: { ctx: RequestContext; api: RequestApi; titleId: string; go: (url: string, opId: string) => void; onContext: (c: RequestContext) => void; onNotice: (n: string | null) => void; onFixName?: () => void }) {
  const consentId = useId();
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  /** The operation startChecks returned: every refresh while waiting pins it. */
  const launched = useRef<string | undefined>(undefined);
  const extras = ctx.missing.filter((m) => m.check !== "face");
  const stuck = extras.filter(blocksLaunch);
  const canLaunch = extras.length > 0 && stuck.length === 0;
  const nameMismatch = stuck.some((m) => m.reason === "name_mismatch");

  // Didit is still creating the session: poll the read-only context until the check is ready or satisfied.
  const attempt = useRef(0);
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await api.refresh(launched.current);
      if (cancelled) return;
      if (res.ok) {
        onContext(res.data);
        if (res.data.nextAction !== "extras") return;
      }
      timer = setTimeout(tick, pollDelayMs(attempt.current++));
    };
    timer = setTimeout(tick, pollDelayMs(attempt.current++));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [waiting, api, onContext]);

  async function start() {
    if (!consent) {
      setConsentError(true);
      return;
    }
    setBusy(true);
    onNotice(null);
    const c = requestConsent(ctx, true);
    // Checks start from a saved draft (the answers survive the trip to Didit).
    let draftId = ctx.draft?.id;
    if (!draftId) {
      const saved = await api.saveDraft({ expectedVersion: 1, policyVersion: ctx.event.policyVersion, formVersion: ctx.event.formVersion, application: ctx.prefill, consent: c });
      if (!saved.ok) {
        setBusy(false);
        if (saved.error.context) onContext(saved.error.context);
        onNotice(saved.error.message);
        return;
      }
      onContext(saved.data);
      draftId = saved.data.draft?.id;
    }
    if (!draftId) {
      setBusy(false);
      onNotice("We could not save your request. Try again.");
      return;
    }
    const res = await api.startChecks({ draftId, expectedPolicyVersion: ctx.event.policyVersion, consent: c });
    if (!res.ok) {
      setBusy(false);
      if (res.error.context) onContext(res.error.context);
      onNotice(errorCopy(res.error));
      return;
    }
    const launch = res.data;
    launched.current = "opId" in launch ? launch.opId : undefined;
    if (launch.state === "ready") return go(launch.url, launch.opId);
    setBusy(false);
    if (launch.state === "creating") setWaiting(true);
    else if (launch.state === "blocked") onNotice(launch.code === "provider_unavailable" ? "Didit is not reachable right now. Your answers are saved; try again in a few minutes." : launch.code === "budget" ? "Verification is paused for now. Your answers are saved; try again later." : launch.code === "consent_required" ? "Tick the box to continue." : "Your verification is being reviewed. We email you when it is done.");
    else {
      const next = await api.refresh(launched.current);
      if (next.ok) onContext(next.data);
    }
  }

  const action = canLaunch ? (
    <Button size="xl" block loading={busy || waiting} onClick={start}>
      {busy ? "Opening Didit…" : waiting ? "Preparing…" : "Verify with Didit"}
    </Button>
  ) : nameMismatch && onFixName && !stuck.some((m) => m.reason === "below_minimum") ? (
    <Button size="xl" block onClick={onFixName}>
      Edit my name
    </Button>
  ) : null;

  return (
    <>
      <StepBody>
        <Eyebrow>THIS EVENT ASKS FOR</Eyebrow>
        <Title id={titleId} size={22}>
          {extras.length === 1 ? `Verify your ${extraLabel(extras[0]!).toLowerCase()}` : "A couple of checks for this event"}
        </Title>
        <Lead>The hosts need these before they review requests. Didit checks them once and you reuse them for other events.</Lead>
        <RowGroup
          title="STILL NEEDED"
          rows={extras.map((m) => ({ key: m.check, label: extraLabel(m), detail: m.reason === "absent" ? EXTRA_HINTS[m.check] : reasonCopy(m.reason), action: <MetGlyph met={false} /> }))}
        />
        {ctx.badges.some((b) => b.state === "verified" && b.check !== "email") ? (
          <RowGroup title="ALREADY VERIFIED" rows={ctx.badges.filter((b) => b.state === "verified").map((b) => ({ key: b.check, label: b.label, detail: "Reused", action: <MetGlyph met /> }))} />
        ) : null}
        {waiting ? (
          <div role="status" className={o.waitText}>
            <Lead>Preparing your check with Didit. This takes a few seconds.</Lead>
          </div>
        ) : null}
        {canLaunch ? (
          <>
            <div className={s.consent}>
              <Checkbox id={consentId} name="checksConsent" size="lg" checked={consent} invalid={consentError} onChange={(e) => (setConsent(e.target.checked), e.target.checked && setConsentError(false))} />
              <label htmlFor={consentId}>{ctx.consent.text}</label>
            </div>
            {consentError ? (
              <p className={s.consentError} role="alert">
                Tick the box to continue
              </p>
            ) : null}
          </>
        ) : (
          <Callout tone="info" live={false}>
            {stuck.some((m) => m.reason === "below_minimum")
              ? "This event has a minimum age you do not meet, so a request cannot be sent."
              : nameMismatch
                ? "The name on your ID doesn't match your profile. Update your name to continue."
                : "Nothing to do right now. We email you when Didit finishes."}
          </Callout>
        )}
        <SecuredByDidit />
      </StepBody>
      {action ? <SheetFooter>{action}</SheetFooter> : null}
    </>
  );
}

