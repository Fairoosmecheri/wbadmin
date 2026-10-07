import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { assertRole, type Actor } from "@/lib/authorization";
import { canManageUser } from "./policy";
import { createUserSchema, updateUserSchema } from "./validation";

export const userSelect = { id: true, name: true, email: true, role: true, phone: true, active: true, lastLoginAt: true, createdAt: true } as const;

export async function createUser(actor: Actor, input: unknown) {
  assertRole(actor, "ADMIN");
  const { password, ...data } = createUserSchema.parse(input);
  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  return prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { id, ...data, accounts: { create: { id: randomUUID(), accountId: id, providerId: "credential", password: passwordHash } } }, select: userSelect });
    await tx.auditLog.create({ data: { userId: actor.id, action: "USER_CREATED", entityType: "User", entityId: id, metadata: { role: data.role } } });
    return user;
  });
}

export async function updateUser(actor: Actor, id: string, input: unknown) {
  assertRole(actor, "ADMIN");
  const { password, ...data } = updateUserSchema.parse(input);
  const passwordHash = password ? await hashPassword(password) : undefined;
  return prisma.$transaction(async tx => {
    const target = await tx.user.findUnique({ where: { id }, select: userSelect });
    if (!target) throw new AppError(404, "User not found.");
    const activeAdmins = await tx.user.count({ where: { active: true, role: "ADMIN" } });
    const violation = canManageUser(actor, target, data, activeAdmins);
    if (violation) throw new AppError(409, violation);
    const user = await tx.user.update({ where: { id }, data, select: userSelect });
    if (passwordHash) await tx.account.updateMany({ where: { userId: id, providerId: "credential" }, data: { password: passwordHash } });
    if (passwordHash || data.active === false || (data.role && data.role !== target.role)) await tx.session.deleteMany({ where: { userId: id } });
    await tx.auditLog.create({ data: { userId: actor.id, action: data.active === false ? "USER_DISABLED" : "USER_UPDATED", entityType: "User", entityId: id, metadata: { fields: Object.keys(data), passwordChanged: !!passwordHash } } });
    return user;
  }, { isolationLevel: "Serializable" });
}
