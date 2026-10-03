import { queryable, type Db } from "@didit-events/core";
import { getDb } from "@didit-events/core/db";

/**
 * Hosts on the public page (flow v3): a speaker entry may name a Didit Events account by email. The public page never
 * shows that email; it shows the account's profile photo through GET /api/events/:id/hosts/:index/photo, versioned
 * with the account's `updated_at` so a new upload shows at once and the URL can be cached.
 */
export type HostEntry = { name: string; role: string; photoUrl?: string; email?: string };

export const hostPhotoPath = (eventId: string, index: number, version: Date) => `/api/events/${eventId}/hosts/${index}/photo?v=${version.getTime()}`;

/** email → photo version, for live accounts that have a stored photo. */
export async function hostPhotoVersions(hosts: readonly HostEntry[], db: Db = getDb()): Promise<Map<string, Date>> {
  const emails = [...new Set(hosts.map((h) => h.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))];
  if (!emails.length) return new Map();
  const rows = await queryable(db).query<{ email: string; updated_at: Date }>(
    "select email,updated_at from accounts where email=any($1::text[]) and photo is not null and deleting_at is null and deleted_at is null",
    [emails],
  );
  return new Map(rows.map((r) => [r.email, new Date(r.updated_at)]));
}

/** Public host cards: name, role and a photo (the account's, else an explicit https photo); the email is dropped. */
export function publicHosts(eventId: string, hosts: readonly HostEntry[], versions: ReadonlyMap<string, Date> = new Map()) {
  return hosts.map((h, i) => {
    const version = h.email ? versions.get(h.email.trim().toLowerCase()) : undefined;
    const photoUrl = version ? hostPhotoPath(eventId, i, version) : h.photoUrl;
    return { name: h.name, role: h.role, ...(photoUrl ? { photoUrl } : {}) };
  });
}

/** The stored photo of the account a published event names as host `index` (null: no such host, account or photo). */
export async function hostPhoto(eventId: string, index: number, db: Db = getDb()): Promise<Buffer | null> {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 50) return null;
  const [row] = await queryable(db).query<{ photo: Buffer | Uint8Array | null }>(
    `select a.photo from events e join accounts a on a.email=lower(e.speakers->$2::int->>'email')
     where e.id=$1 and e.status<>'draft' and a.photo is not null and a.deleting_at is null and a.deleted_at is null`,
    [eventId, index],
  );
  return row?.photo ? Buffer.from(row.photo) : null;
}

/** Staff host picker: staff and guest accounts matching an email or name fragment (never more than 8). */
export async function searchPeople(q: string, db: Db = getDb()): Promise<{ email: string; name: string; hasPhoto: boolean }[]> {
  const term = q.trim().toLowerCase();
  if (term.length < 2 || term.length > 120) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await queryable(db).query<{ email: string; name: string | null; has_photo: boolean }>(
    `select email,max(name) as name,bool_or(has_photo) as has_photo from (
       select a.email,nullif(coalesce(a.full_name,concat_ws(' ',a.first_name,a.last_name)),'') as name,a.photo is not null as has_photo,0 as rank
         from accounts a where a.deleting_at is null and a.deleted_at is null and (a.email like $1 or lower(coalesce(a.full_name,concat_ws(' ',a.first_name,a.last_name))) like $1)
       union all
       select s.email,null,false,1 from staff s where s.disabled_at is null and s.email like $1
     ) people group by email order by min(rank),email limit 8`,
    [like],
  );
  return rows.map((r) => ({ email: r.email, name: r.name ?? "", hasPhoto: r.has_photo }));
}

/** Staff host picker avatar: the stored photo of the live account with this email (null: no account or photo). */
export async function hostAccountPhoto(email: string, db: Db = getDb()): Promise<Buffer | null> {
  const e = email.trim().toLowerCase();
  if (!e || e.length > 254 || !e.includes("@")) return null;
  const [row] = await queryable(db).query<{ photo: Buffer | Uint8Array | null }>(
    "select photo from accounts where email=$1 and photo is not null and deleting_at is null and deleted_at is null",
    [e],
  );
  return row?.photo ? Buffer.from(row.photo) : null;
}
