/** Submit the readable double-submit token with programmatic server actions. */
export function actionCsrf(): string {
  const raw = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("__Host-csrf="));
  try { return raw ? decodeURIComponent(raw.slice("__Host-csrf=".length)) : ""; } catch { return ""; }
}
