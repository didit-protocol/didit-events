import type { Metadata } from "next";
import { SubmitButton } from "@didit-events/ui";
import { createApiTokenService } from "@didit-events/core/api-tokens";
import { requireStaffAccess } from "../../../../src/auth/access";
import { CsrfField } from "../../../../src/auth/CsrfField";
import { TokenForm } from "./TokenForm";
import { TokensView } from "./TokensView";
import { revokeTokenAction } from "./actions";

export const metadata: Metadata = { title: "Personal tokens · Didit Events", robots: { index: false } };
export const dynamic = "force-dynamic";
export default async function TokensPage() {
  const actor = await requireStaffAccess("tokens.manage", "/admin/team/tokens");
  const tokens = await createApiTokenService().list(actor);
  return (
    <TokensView
      email={actor.email}
      tokens={tokens}
      now={new Date()}
      form={<TokenForm />}
      revoke={(token) => (
        <form action={revokeTokenAction}>
          <CsrfField />
          <input type="hidden" name="id" value={token.id} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Revoking…" aria-label={`Revoke ${token.name}`}>
            Revoke
          </SubmitButton>
        </form>
      )}
    />
  );
}
