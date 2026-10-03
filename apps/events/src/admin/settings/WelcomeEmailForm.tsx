"use client";
import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useEffect, useState } from "react";
import { Button, Textarea, TextField } from "@didit-events/ui";
import { saveWelcomeAction } from "../../../app/admin/(events)/events/[id]/(tabs)/settings/actions";
import type { WelcomePreview } from "../form/types";
import { notifySessionExpired } from "../system/session";
import type { SettingsSaveState } from "./types";
import s from "./Settings.module.css";

const IDLE: SettingsSaveState = { status: "idle" };

/** A-11 "Welcome email": subject + Wi-Fi and agenda block. The save row appears once something changed. */
export function WelcomeEmailForm({ eventId, welcome, editVersion }: { eventId: string; welcome: WelcomePreview; editVersion?: number }) {
  const [state, action, pending] = useActionState(saveWelcomeAction.bind(null, eventId), IDLE);
  // Edited since the last action result: a new result (saved / invalid) resets it without an effect.
  const [editedAt, setEditedAt] = useState<SettingsSaveState | null>(null);
  const dirty = editedAt === state;
  useEffect(() => {
    if (state.status === "error" && state.message === "session_expired") notifySessionExpired();
  }, [state]);
  const errors = state.status === "invalid" ? state.errors : {};
  return (
    <form action={action} className={s.fields} onInput={() => setEditedAt(state)}><CsrfField />
      {editVersion !== undefined ? <input type="hidden" name="expectedVersion" value={editVersion} /> : null}
      <TextField name="subject" label="Subject" defaultValue={welcome.subject} maxLength={150} error={errors.subject} />
      <Textarea name="block" label="Wi-Fi and agenda block" defaultValue={welcome.block} maxLength={1000} error={errors.block} className={s.block} />
      {dirty || state.status !== "idle" ? (
        <div className={s.saveRow} aria-live="polite">
          {dirty || state.status === "invalid" ? (
            <Button type="submit" size="sm" loading={pending}>
              Save welcome email
            </Button>
          ) : null}
          {state.status === "saved" && !dirty ? <span className={s.saved}>Saved</span> : null}
          {state.status === "error" && state.message !== "session_expired" ? <p className={s.formError}>{state.message}</p> : null}
        </div>
      ) : null}
    </form>
  );
}
