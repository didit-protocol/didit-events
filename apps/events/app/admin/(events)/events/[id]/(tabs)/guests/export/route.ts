import { guestsCsv } from "../../../../../../../../src/admin/guests/csv";
import { filterGuests, parseGuestQuery } from "../../../../../../../../src/admin/guests/query";
import { routeEventAccess } from "../../../../../../../../src/auth/access";
import { allGuests } from "../data";

// A-05 "Export CSV": the current search + chip filter as CSV (cells neutralised against formula injection in csv.ts).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { await routeEventAccess(request, id, "guests.export"); }
  catch (error) { const status = error instanceof Error && "status" in error && error.status === 403 ? 403 : 401; return new Response(status === 403 ? "Your role on this event can’t export the guest list." : "Sign in again.", { status }); }
  const url = new URL(request.url);
  const query = parseGuestQuery(Object.fromEntries(url.searchParams));
  // The bulk bar exports the selected rows (`?ids=a,b`), the toolbar the current filters.
  const ids = new Set((url.searchParams.get("ids") ?? "").split(",").filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)));
  const all = await allGuests(id);
  const rows = ids.size ? all.filter((g) => ids.has(g.id)) : filterGuests(all, query);
  return new Response(guestsCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${id.replace(/[^a-z0-9-]/gi, "")}-guests.csv"`,
      "cache-control": "no-store",
    },
  });
}
