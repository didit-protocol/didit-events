"use client";

import { useId, useState } from "react";
import { Button, ButtonLink, GoogleButton } from "@didit-events/ui";
import type { InAppInfo } from "../../auth/inapp";
import s from "./InAppGoogle.module.css";

/** "the X browser", "this in-app browser". */
const where = (app: InAppInfo["app"]) => (app === "other" ? "this in-app browser" : `the ${app} browser`);
const browser = (os: InAppInfo["os"]) => (os === "ios" ? "Safari" : os === "android" ? "Chrome" : "Safari or Chrome");

/**
 * "Continue with Google" inside an in-app browser, where Google sign-in fails: the first tap shows a note in place
 * (use the email code, or open the page in the real browser) with Open in browser, Copy link and a way to try Google
 * anyway (`force=1`). Without JS the link reaches the OIDC start route, which sends an in-app browser back to /login
 * with the same note open.
 */
export function InAppGoogle({ inApp, googleHref, open: initialOpen = false }: { inApp: InAppInfo; googleHref: string; open?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const urlId = useId();
  // Read on the tap: the absolute URL needs the browser's origin.
  const link = () => new URL(inApp.path, window.location.origin).href;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link());
      setCopy("copied");
    } catch {
      // Some webviews refuse the clipboard: show the link to select and copy by hand.
      setCopy("manual");
    }
  };
  return (
    <div className={s.wrap}>
      <GoogleButton
        variant="outline"
        size="lg"
        href={googleHref}
        onNavigate={(e) => {
          if (open) return;
          e.preventDefault();
          setOpen(true);
        }}
      />
      {open ? (
        <div className={s.note} role="status">
          <p className={s.text}>{`Google sign-in doesn't work inside ${where(inApp.app)}. Use the email code, or open this page in ${browser(inApp.os)}.`}</p>
          <div className={s.actions}>
            {inApp.openHref ? (
              <ButtonLink href={inApp.openHref} variant="outline" size="lg" block {...(inApp.os === "other" ? { target: "_blank", rel: "noopener" } : {})}>
                Open in browser
              </ButtonLink>
            ) : null}
            <Button variant="outline" size="lg" block onClick={copyLink}>
              {copy === "copied" ? "Link copied" : "Copy link"}
            </Button>
          </div>
          {copy === "manual" ? (
            <>
              <label htmlFor={urlId} className={s.hint}>
                Copy this link and paste it in your browser.
              </label>
              <input id={urlId} className={s.url} readOnly value={typeof window === "undefined" ? inApp.path : link()} onFocus={(e) => e.currentTarget.select()} />
            </>
          ) : null}
          <p className={s.hint}>
            {inApp.os === "ios" ? "If nothing opens, tap ••• and choose Open in Safari, or copy the link." : "If nothing opens, copy the link and paste it in your browser."}
          </p>
          <a href={`${googleHref}${googleHref.includes("?") ? "&" : "?"}force=1`} className={s.anyway}>
            Try Google anyway
          </a>
        </div>
      ) : null}
    </div>
  );
}
