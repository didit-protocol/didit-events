import { safeNext } from "../../src/accounts/links";
import { guestPage } from "../../src/auth/access";
import { readOnboarding } from "../../src/server/event-model-api";
export async function getOnboarding(returnTo?:string){const target=safeNext(returnTo),view=await readOnboarding().getOnboarding(await guestPage(`/onboarding?returnTo=${encodeURIComponent(target)}`));return {...view,returnTo:target};}
