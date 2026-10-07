import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { customerScope, type Actor } from "@/lib/authorization";
import { getGeneralSettings } from "@/modules/auth/settings";
import { canManageFollowUp, transitionError } from "./policy";
import { followUpDateRange } from "./dates";
import { createFollowUpSchema, listFollowUpsSchema, updateFollowUpSchema } from "./validation";

const include = { customer: { select: { id: true, businessName: true, contactPerson: true, phoneNormalized: true, assignedUserId: true } }, assignedUser: { select: { id: true, name: true } } } satisfies Prisma.FollowUpInclude;

export async function accessibleCustomer(actor: Actor, customerId: string) {
  if (!actor.active) throw new AppError(403, "Your account is inactive.");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, ...customerScope(actor) }, select: { id: true, businessName: true, assignedUserId: true, archivedAt: true } });
  if (!customer) throw new AppError(404, "Customer not found.");
  return customer;
}

async function validateAssignee(actor: Actor, assignedUserId: string, customerAssignee: string | null) {
  if (actor.role === "SALESMAN" && assignedUserId !== actor.id) throw new AppError(403, "You can only assign follow-ups to yourself.");
  const assignedUser = await prisma.user.findFirst({ where: { id: assignedUserId, active: true }, select: { role: true } });
  if (!assignedUser) throw new AppError(422, "Choose an active team member.");
  if (assignedUser.role === "SALESMAN" && assignedUserId !== customerAssignee) throw new AppError(422, "Assign this customer to the salesperson before assigning their follow-up.");
}

export async function listFollowUps(actor: Actor, query: unknown) {
  if (!actor.active) throw new AppError(403, "Your account is inactive.");
  const options = listFollowUpsSchema.parse(query);
  if (options.customerId) await accessibleCustomer(actor, options.customerId);
  const { timezone } = await getGeneralSettings();
  const now = new Date();
  const base: Prisma.FollowUpWhereInput = {
    customer: customerScope(actor),
    ...(actor.role === "SALESMAN" || options.bucket === "my" ? { assignedUserId: actor.id } : options.assignedUserId ? { assignedUserId: options.assignedUserId } : {}),
    ...(options.customerId ? { customerId: options.customerId } : {}),
  };
  const where: Prisma.FollowUpWhereInput = { ...base, ...(options.status !== "ALL" ? { status: options.status } : {}), dueAt: followUpDateRange(options.bucket, now, timezone) };
  const [items, total, counts, assignees] = await Promise.all([
    prisma.followUp.findMany({ where, include, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: options.limit, skip: (options.page - 1) * options.limit }),
    prisma.followUp.count({ where }),
    Promise.all(["overdue", "today", "tomorrow", "week", "upcoming"].map(async (bucket) => [bucket, await prisma.followUp.count({ where: { ...base, status: "PENDING", dueAt: followUpDateRange(bucket, now, timezone) } })])),
    prisma.user.findMany({ where: { active: true, ...(actor.role === "SALESMAN" ? { id: actor.id } : {}) }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
  ]);
  return { items, total, page: options.page, pages: Math.max(1, Math.ceil(total / options.limit)), counts: Object.fromEntries(counts), timezone, actorId: actor.id, actorRole: actor.role, assignees };
}

export async function createFollowUp(actor: Actor, input: unknown) {
  const data = createFollowUpSchema.parse(input);
  const customer = await accessibleCustomer(actor, data.customerId);
  if (customer.archivedAt) throw new AppError(409, "Restore this customer before creating a follow-up.");
  const assignedUserId = data.assignedUserId || (actor.role === "SALESMAN" ? actor.id : customer.assignedUserId || actor.id);
  await validateAssignee(actor, assignedUserId, customer.assignedUserId);
  return prisma.$transaction(async (tx) => {
    const followUp = await tx.followUp.create({ data: { ...data, assignedUserId, createdByUserId: actor.id }, include });
    await tx.activityLog.create({ data: { customerId: data.customerId, userId: actor.id, type: "FOLLOWUP_CREATED", entityType: "FollowUp", entityId: followUp.id, description: `${actor.name} scheduled ${followUp.title}.` } });
    return followUp;
  });
}

export async function updateFollowUp(actor: Actor, id: string, input: unknown) {
  if (!actor.active) throw new AppError(403, "Your account is inactive.");
  const data = updateFollowUpSchema.parse(input);
  const existing = await prisma.followUp.findFirst({ where: { id, customer: customerScope(actor), ...(actor.role === "SALESMAN" ? { assignedUserId: actor.id } : {}) }, include });
  if (!existing || !canManageFollowUp(actor, existing)) throw new AppError(404, "Follow-up not found.");
  const status = data.status ?? existing.status;
  const error = transitionError(existing.status, status, data.outcome);
  if (error) throw new AppError(409, error);
  const { updatedAt, ...patch } = data;
  if (updatedAt && new Date(updatedAt).getTime() !== existing.updatedAt.getTime()) throw new AppError(409, "This follow-up changed. Refresh before saving.");
  if (data.assignedUserId) await validateAssignee(actor, data.assignedUserId, existing.customer.assignedUserId);
  const completedAt = status === "COMPLETED" ? new Date() : null;
  return prisma.$transaction(async (tx) => {
    const changed = await tx.followUp.updateMany({ where: { id, status: "PENDING", updatedAt: existing.updatedAt }, data: { ...patch, status, completedAt, outcome: status === "COMPLETED" ? data.outcome : null } });
    if (changed.count !== 1) throw new AppError(409, "This follow-up changed. Refresh before saving.");
    if (status === "COMPLETED") await tx.customer.update({ where: { id: existing.customerId }, data: { lastContactedAt: completedAt, ...(data.outcome === "ORDER_CONFIRMED" ? { lastOrderDate: completedAt } : {}) } });
    await tx.activityLog.create({ data: { customerId: existing.customerId, userId: actor.id, type: `FOLLOWUP_${status === "PENDING" ? "UPDATED" : status}`, entityType: "FollowUp", entityId: id, description: `${actor.name} ${status === "PENDING" ? "updated" : status === "COMPLETED" ? "completed" : "cancelled"} ${patch.title || existing.title}${data.outcome ? ` · ${data.outcome.toLowerCase().replaceAll("_", " ")}` : ""}.` } });
    return tx.followUp.findUniqueOrThrow({ where: { id }, include });
  });
}
