import type { Actor } from "@/modules/auth/policy";

export function canManageFollowUp(actor: Actor, followUp: { assignedUserId: string; customer: { assignedUserId: string | null } }) {
  return actor.active && (actor.role !== "SALESMAN" || (followUp.assignedUserId === actor.id && followUp.customer.assignedUserId === actor.id));
}

export function canEditNote(actor: Actor, authorId: string) {
  return actor.active && (actor.role === "ADMIN" || actor.id === authorId);
}

export function transitionError(current: string, next: string, outcome?: string | null) {
  if (current !== "PENDING") return "Completed and cancelled follow-ups are closed. Create a new follow-up for the next action.";
  if (!["PENDING", "COMPLETED", "CANCELLED"].includes(next)) return "Unknown follow-up status.";
  if (next === "COMPLETED" && !outcome) return "Choose an outcome before completing the follow-up.";
  if (next !== "COMPLETED" && outcome) return "An outcome can only be recorded when completing a follow-up.";
  return null;
}
