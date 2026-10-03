export type TeamActionState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string; email?: string; role?: string };
export interface TeamMemberRow { id: string; email: string; name: string | null; role: "host" | "operator"; invitedBy: string; added: string }
