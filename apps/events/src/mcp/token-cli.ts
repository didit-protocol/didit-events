import { createDb } from "@didit-events/core/db";
import { bootstrapApiToken } from "@didit-events/core/api-tokens";

const [email, name, ...rest] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !email || !name || rest.length) {
  console.error('Usage: DATABASE_URL=... pnpm --filter @didit-events/events mcp:token <email> <name>');
  process.exitCode = 1;
} else {
  const db = createDb({ url: process.env.DATABASE_URL });
  try {
    const { token, metadata } = await bootstrapApiToken(email, name, db);
    console.error(`Created ${metadata.name} for ${metadata.staffEmail}; expires ${metadata.expiresAt.toISOString()}. Copy the token now; it will not be shown again.`);
    process.stdout.write(`${token}\n`);
  } catch {
    console.error("Token creation failed. Check DATABASE_URL, migrations, the name, and enabled staff membership in STAFF_EMAIL_DOMAIN.");
    process.exitCode = 1;
  } finally { await db.close(); }
}
