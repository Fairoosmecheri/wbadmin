export type TeamMember = { id: string; name: string; role?: string };
export type FollowUpItem = {
  id: string; title: string; notes: string | null; type: string; priority: string; status: string;
  dueAt: string; updatedAt: string; completedAt: string | null; outcome: string | null;
  assignedUserId: string; assignedUser: TeamMember;
  customer: { id: string; businessName: string; contactPerson: string; phoneNormalized: string; assignedUserId: string | null };
};
export type FollowUpList = { items: FollowUpItem[]; total: number; page: number; pages: number; counts: Record<string, number>; timezone: string; actorId: string; actorRole: string; assignees: TeamMember[] };
export type CustomerOption = { id: string; businessName: string; contactPerson: string; assignedUserId: string | null };
export function friendly(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, value => value.toUpperCase()); }
export function formatFollowUpDate(value: string, timezone: string) { return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
