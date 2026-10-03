import { configureOidc, identity } from "@didit-events/core/identity";
import { createOidcAdapter } from "./oidc";
configureOidc(createOidcAdapter());
export { identity };
