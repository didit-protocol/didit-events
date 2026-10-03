"use client";
import { useEffect } from "react";
/** Next server-action requests carry the existing B2-issued double-submit token. */
export function ActionCsrf() {
 useEffect(() => {
  const original = window.fetch;
  const wrapped: typeof fetch = (input, init) => {
   const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
   if (request.headers.has("next-action") && request.url.startsWith(location.origin + "/")) {
    const csrf = /(?:^|;\s*)__Host-csrf=([^;]*)/.exec(document.cookie)?.[1];
    if (csrf) request.headers.set("x-csrf", decodeURIComponent(csrf));
   }
   return original(request);
  };
  window.fetch = wrapped; return () => { if (window.fetch === wrapped) window.fetch = original; };
 }, []);
 return null;
}
