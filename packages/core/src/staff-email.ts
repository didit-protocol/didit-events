/** Shared staff-domain policy. Membership and enabled status are still checked separately. */
export const DEFAULT_STAFF_EMAIL_DOMAIN = "didit.me";

export function staffEmailDomains(value = process.env.STAFF_EMAIL_DOMAIN ?? DEFAULT_STAFF_EMAIL_DOMAIN): string[] {
  const domains = [...new Set(value.split(",").map(domain => domain.trim().toLowerCase()))];
  // DNS labels only: reject empty entries, wildcards, URLs and SQL/regexp metacharacters.
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  if (domains.some(domain => domain.length > 253 || !new RegExp(`^${label}(?:\\.${label})+$`).test(domain))) {
    throw new Error("STAFF_EMAIL_DOMAIN must contain comma-separated email domains");
  }
  return domains;
}

export function isStaffEmail(email: string, domains = staffEmailDomains()): boolean {
  const normalized = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(normalized) && domains.includes(normalized.split("@")[1]!);
}

/** Column names are code-owned, never request input. Domains are validated before SQL interpolation. */
export function staffEmailSql(column: string): string {
  if (!/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/.test(column)) throw new Error("Invalid staff email column");
  const domains = staffEmailDomains().map(domain => domain.replaceAll(".", "[.]")).join("|");
  return `lower(btrim(${column})) ~ '^[^[:space:]@]+@(${domains})$'`;
}
