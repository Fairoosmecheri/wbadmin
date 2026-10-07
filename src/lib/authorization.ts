import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { hasRole, type Actor, type Role } from "@/modules/auth/policy";
export { customerScope } from "@/modules/auth/policy";
export type { Actor, Role } from "@/modules/auth/policy";

export async function requireUser(): Promise<Actor> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AppError(401, "Please sign in to continue.");
  // Re-read access on every request so deactivation and role changes apply immediately.
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, email: true, role: true, active: true } });
  if (!user?.active) throw new AppError(401, "Your account is inactive. Contact your administrator.");
  return user;
}

export function assertRole(actor: Actor, ...allowed: Role[]) {
  if (!hasRole(actor, allowed)) throw new AppError(403, "Your role does not permit this action.");
}

export async function requireRole(...allowed: Role[]): Promise<Actor> {
  const actor = await requireUser();
  assertRole(actor, ...allowed);
  return actor;
}
