"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { IdentityError } from "@didit-events/core/identity";
import { createApiTokenService } from "@didit-events/core/api-tokens";
import { requireStaffAccess } from "../../../../src/auth/access";
import { guardAction } from "../../../../src/auth/actions";

export type TokenState = { token?: string; error?: string };
export async function createTokenAction(_previous: TokenState, form: FormData): Promise<TokenState> {
  const actor = await requireStaffAccess("tokens.manage", "/admin/team/tokens");
  await guardAction(form);
  try {
    const result = await createApiTokenService().create(actor, z.string().trim().min(1).max(100).parse(form.get("name")));
    revalidatePath("/admin/team/tokens");
    return { token: result.token };
  } catch (error) {
    if (error instanceof z.ZodError) return { error: "Enter a token name between 1 and 100 characters." };
    if (error instanceof IdentityError) return { error: "Your staff access changed. Reload the page." };
    return { error: "Could not create the token. Try again." };
  }
}
export async function revokeTokenAction(form: FormData): Promise<void> {
  const actor = await requireStaffAccess("tokens.manage", "/admin/team/tokens");
  await guardAction(form);
  await createApiTokenService().revoke(actor, z.uuid().parse(form.get("id")));
  revalidatePath("/admin/team/tokens");
}
