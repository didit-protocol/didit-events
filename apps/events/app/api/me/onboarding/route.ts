import { failure,guestRead,readOnboarding,success } from "../../../../src/server/event-model-api";

export async function GET(request:Request){try{return success(await readOnboarding().getOnboarding(await guestRead(request)));}catch(e){return failure(e);}}
