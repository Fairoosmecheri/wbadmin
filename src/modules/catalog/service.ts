import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { assertRole, type Actor } from "@/lib/authorization";
import { z } from "zod";
export const catalogKindSchema = z.enum(["customerTypes", "areas", "routes", "tags"]);
export type CatalogKind = z.infer<typeof catalogKindSchema>;
const inputSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).nullable().optional(), active: z.boolean().optional(), assignedUserId: z.string().nullable().optional(), color: z.enum(["emerald", "blue", "amber", "purple", "rose", "slate"]).optional() });
export async function getCatalog(includeInactive = false) {
  const where = includeInactive ? {} : { active: true };
  const [customerTypes, areas, routes, tags, users] = await Promise.all([
    prisma.customerType.findMany({ where, orderBy: { name: "asc" } }), prisma.area.findMany({ where, orderBy: { name: "asc" } }),
    prisma.route.findMany({ where, orderBy: { name: "asc" } }), prisma.tag.findMany({ where, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
  ]);
  return { customerTypes, areas, routes, tags, users };
}
export async function saveCatalog(kindInput: string, input: unknown, actor: Actor, id?: string) {
  assertRole(actor, "ADMIN");
  const kind = catalogKindSchema.parse(kindInput), data = inputSchema.parse(input);
  if (kind === "routes" && data.assignedUserId) {
    const user = await prisma.user.findFirst({ where: { id: data.assignedUserId, active: true } });
    if (!user) throw new AppError(422, "Choose an active team member.");
  }
  const result = await prisma.$transaction(async tx => {
    const common = { name: data.name, active: data.active };
    let row;
    if (kind === "customerTypes") { const values = { ...common, description: data.description, ...(data.active !== undefined && { archivedAt: data.active ? null : new Date() }) }; row = id ? await tx.customerType.update({ where: { id }, data: values }) : await tx.customerType.create({ data: values }); }
    else if (kind === "areas") row = id ? await tx.area.update({ where: { id }, data: common }) : await tx.area.create({ data: common });
    else if (kind === "routes") { const values = { ...common, description: data.description, assignedUserId: data.assignedUserId }; row = id ? await tx.route.update({ where: { id }, data: values }) : await tx.route.create({ data: values }); }
    else { const values = { ...common, description: data.description, color: data.color, ...(data.active !== undefined && { archivedAt: data.active ? null : new Date() }) }; row = id ? await tx.tag.update({ where: { id }, data: values }) : await tx.tag.create({ data: values }); }
    await tx.auditLog.create({ data: { userId: actor.id, action: id ? "catalog.updated" : "catalog.created", entityType: kind, entityId: row.id } });
    return row;
  });
  return result;
}
