import { parseSpendCapUsd } from "../env.ts";
import { getDb } from "../db/index.ts";
import { DiditClient } from "../didit/client.ts";
import { Onboarding } from "../identity/onboarding.ts";
import { ModelVerification,type ModelVerificationOptions } from "./model-verification.ts";
export function createModelServices(options: ModelVerificationOptions) {
  const verification = new ModelVerification(options);
  const onboarding = new Onboarding({ db: options.db, launch: id => verification.launch(id) });
  return { verification, onboarding };
}
export function modelServices() {
  return createModelServices({ db: getDb(), client: new DiditClient({ apiKey: process.env.DIDIT_API_KEY ?? "" }),
    appUrl: process.env.APP_URL ?? "http://localhost:3000", appDailyCapUsd: Number(process.env.DIDIT_APP_DAILY_CAP_USD ?? 300),
    eventDailyCapUsd: Number(process.env.DIDIT_EVENT_DAILY_CAP_USD ?? 100), totalCapUsd: parseSpendCapUsd(process.env.DIDIT_SPEND_CAP_USD) });
}
