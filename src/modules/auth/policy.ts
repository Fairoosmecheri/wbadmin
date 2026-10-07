export const roles = ["ADMIN", "MANAGER", "SALESMAN"] as const;
export type Role = (typeof roles)[number];
export type Actor = { id: string; name: string; email: string; role: Role; active: boolean };

export function hasRole(actor: Actor, allowed: readonly Role[]) {
  return actor.active && allowed.includes(actor.role);
}

export function canManageUser(actor: Actor, target: Actor, next: { role?: Role; active?: boolean }, activeAdmins: number) {
  if (!hasRole(actor, ["ADMIN"])) return "Only administrators can manage users.";
  if (actor.id === target.id && (next.active === false || (next.role && next.role !== "ADMIN"))) {
    return "Ask another administrator to change your own access.";
  }
  if (target.role === "ADMIN" && target.active && activeAdmins <= 1 && (next.active === false || (next.role && next.role !== "ADMIN"))) {
    return "At least one active administrator is required.";
  }
  return null;
}

export function customerScope(actor: Actor) {
  return actor.role === "SALESMAN" ? { assignedUserId: actor.id } : {};
}
