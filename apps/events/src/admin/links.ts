/** Admin URLs in one place. */
export const adminLinks = {
  home: () => "/admin",
  login: (next?: string) => (next ? `/login?next=${encodeURIComponent(next)}` : "/login?next=%2Fadmin"),
  newEvent: () => "/admin/events/new",
  event: (id: string) => `/admin/events/${encodeURIComponent(id)}`,
  editEvent: (id: string) => `/admin/events/${encodeURIComponent(id)}/edit`,
  tab: (id: string, tab: "guests" | "applicants" | "log" | "door" | "team" | "settings") => `/admin/events/${encodeURIComponent(id)}/${tab}`,
  /** The full-screen door (kiosk mode) of a device that started door mode; the Door tab is `tab(id, "door")`. */
  kiosk: (id: string) => `/admin/events/${encodeURIComponent(id)}/door/kiosk`,
  team: () => "/admin/team",
  calendar: () => "/admin/calendar",
  /** Owner-only People list; `person` opens the drawer on one account. */
  people: (person?: string) => `/admin/people${person ? `?person=${encodeURIComponent(person)}` : ""}`,
  signOut: () => "/api/auth/logout",
};
