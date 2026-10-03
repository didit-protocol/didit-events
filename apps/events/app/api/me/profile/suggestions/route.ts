import { dbSocialSuggestStore,suggestSocialProfiles } from "@didit-events/core/profile/social-suggest";
import { PROFILE_LIMITS } from "../../../../../src/accounts/onboarding";
import { failure,guestRead,success } from "../../../../../src/server/event-model-api";

/** "Is this you?" LinkedIn / X for the name and company being typed. Off (204) without FIRECRAWL_API_KEY. */
export async function GET(request:Request){
  try{
    const principal=await guestRead(request);
    const apiKey=process.env.FIRECRAWL_API_KEY||undefined;
    if(!apiKey)return new Response(null,{status:204,headers:{"Cache-Control":"private, no-store"}});
    const params=new URL(request.url).searchParams;
    const fullName=(params.get("name")??"").slice(0,PROFILE_LIMITS.fullName),company=(params.get("company")??"").slice(0,PROFILE_LIMITS.company);
    return success(await suggestSocialProfiles({fullName,company},{accountId:principal.accountId,apiKey,store:dbSocialSuggestStore(),signal:request.signal}));
  }catch(e){return failure(e);}
}
