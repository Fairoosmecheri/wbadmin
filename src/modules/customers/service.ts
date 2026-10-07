import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { assertRole, customerScope, type Actor } from "@/lib/authorization";
import { buildCustomerWhere, customerListQuerySchema } from "./filters";
import { normalizePhone } from "./phone";
import { customerInputSchema, bulkCustomerSchema } from "./validation";
import { resolveCustomerFilter } from "@/modules/segments/service";
import { getGeneralSettings } from "@/modules/auth/settings";

export const customerInclude = { customerType: true, area: true, route: true, assignedUser: { select: { id: true, name: true } }, tags: { include: { tag: true } } } satisfies Prisma.CustomerInclude;
export async function listCustomers(query: Record<string, unknown>, actor: Actor) {
  const { page, pageSize, sort, direction } = customerListQuerySchema.parse(query);
  const filters = await resolveCustomerFilter(query, actor);
  const where = buildCustomerWhere(filters, actor);
  const [customers, total] = await prisma.$transaction([
    prisma.customer.findMany({ where, include: customerInclude, orderBy: [{ [sort]: direction }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.customer.count({ where }),
  ]);
  return { customers, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), filters };
}
export async function getCustomer(id: string, actor: Actor) {
  const customer = await prisma.customer.findFirst({ where: { id, ...customerScope(actor) }, include: {
    ...customerInclude,
    customerNotes: { take: 30, orderBy: { createdAt: "desc" }, include: { createdByUser: { select: { id: true, name: true } } } },
    activities: { take: 50, orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, name: true } } } },
    followUps: { where: actor.role === "SALESMAN" ? { assignedUserId: actor.id } : {}, take: 30, orderBy: { dueAt: "asc" }, include: { assignedUser: { select: { id: true, name: true } } } },
    conversation: { select: { id: true, status: true, unreadCount: true } },
    campaignRecipients: { take: 20, orderBy: { createdAt: "desc" }, include: { campaign: { select: { id: true, name: true } } } },
  } });
  if (!customer) throw new AppError(404, "Customer not found.");
  return customer;
}
async function validateRelations(tx: Prisma.TransactionClient, data: { customerTypeId?: string | null; areaId?: string | null; routeId?: string | null; assignedUserId?: string | null; tagIds?: string[] }) {
  const checks = [
    data.customerTypeId ? await tx.customerType.count({ where: { id: data.customerTypeId, active: true } }) : 1,
    data.areaId ? await tx.area.count({ where: { id: data.areaId, active: true } }) : 1,
    data.routeId ? await tx.route.count({ where: { id: data.routeId, active: true } }) : 1,
    data.assignedUserId ? await tx.user.count({ where: { id: data.assignedUserId, active: true } }) : 1,
  ];
  if (checks.some(n => !n)) throw new AppError(422, "A selected type, area, route or team member is unavailable. Choose an active option.");
  if (data.tagIds?.length && await tx.tag.count({ where: { id: { in: [...new Set(data.tagIds)] }, active: true } }) !== new Set(data.tagIds).size) throw new AppError(422, "One or more selected tags are unavailable.");
}
export async function saveCustomer(input: unknown, actor: Actor, id?: string) {
  assertRole(actor, "ADMIN", "MANAGER");
  const { expectedUpdatedAt, ...data } = customerInputSchema.parse(input);
  if (data.status === "ARCHIVED") assertRole(actor, "ADMIN");
  const { defaultPhoneCountry } = await getGeneralSettings();
  let phoneNormalized: string, alternatePhone: string | null = null;
  try { phoneNormalized = normalizePhone(data.phone, defaultPhoneCountry); if (data.alternatePhone) alternatePhone = normalizePhone(data.alternatePhone, defaultPhoneCountry); }
  catch (error) { throw new AppError(422, error instanceof Error ? error.message : "Invalid phone number."); }
  return prisma.$transaction(async tx => {
    const existing = id ? await tx.customer.findUnique({ where: { id }, include: { tags: true } }) : null;
    if (id && !existing) throw new AppError(404, "Customer not found.");
    if (existing && (!expectedUpdatedAt || existing.updatedAt.toISOString() !== expectedUpdatedAt)) throw new AppError(409, "This customer changed since you opened the form. Reload the customer to review the latest details and permission before saving.");
    if (existing?.archivedAt) assertRole(actor, "ADMIN");
    // Existing inactive classifications can be retained, but cannot be newly assigned.
    await validateRelations(tx, {
      customerTypeId: data.customerTypeId !== existing?.customerTypeId ? data.customerTypeId : null,
      areaId: data.areaId !== existing?.areaId ? data.areaId : null, routeId: data.routeId !== existing?.routeId ? data.routeId : null,
      assignedUserId: data.assignedUserId !== existing?.assignedUserId ? data.assignedUserId : null,
      tagIds: data.tagIds.filter(tagId => !existing?.tags.some(t => t.tagId === tagId)),
    });
    const { tagIds, customerCode, ...fields } = data;
    const changedPhone = !!existing && existing.phoneNormalized !== phoneNormalized;
    // Permission and the service window belong to a phone number, not a customer name.
    // A replacement number requires a separate, subsequent consent action.
    const effectiveOptIn = changedPhone ? false : data.whatsappOptIn;
    const changedOptIn = existing ? existing.whatsappOptIn !== effectiveOptIn : effectiveOptIn;
    const consentFields = changedOptIn ? (effectiveOptIn ? { whatsappOptInAt: new Date(), whatsappOptOutAt: null, whatsappOptOutReason: null } : { whatsappOptOutAt: new Date(), whatsappOptOutReason: data.whatsappOptOutReason || "Permission withdrawn in CRM" }) : {};
    const phoneReset = changedPhone ? { whatsappOptIn: false, whatsappOptInAt: null, whatsappOptInSource: null, whatsappOptOutAt: null, whatsappOptOutReason: null, lastCustomerMessageAt: null, lastBusinessMessageAt: null, lastContactedAt: null, lastCampaignAt: null } : {};
    const values = { ...fields, ...consentFields, ...phoneReset, alternatePhone, phoneNormalized, customerCode: customerCode || existing?.customerCode || `C-${randomUUID().slice(0, 8).toUpperCase()}`, archivedAt: data.status === "ARCHIVED" ? existing?.archivedAt || new Date() : null };
    const customer = existing
      ? await tx.customer.update({ where: { id }, data: { ...values, tags: { deleteMany: {}, create: [...new Set(tagIds)].map(tagId => ({ tagId })) } }, include: customerInclude })
      : await tx.customer.create({ data: { ...values, tags: { create: [...new Set(tagIds)].map(tagId => ({ tagId })) } }, include: customerInclude });
    const events = [{ type: existing ? "CUSTOMER_UPDATED" : "CUSTOMER_CREATED", description: existing ? "Customer information updated" : "Customer added to the CRM" }];
    if (existing && existing.assignedUserId !== data.assignedUserId) events.push({ type: "ASSIGNMENT_CHANGED", description: customer.assignedUser ? `Assigned to ${customer.assignedUser.name}` : "Customer assignment removed" });
    if (existing && existing.tags.map(t => t.tagId).sort().join() !== [...new Set(tagIds)].sort().join()) events.push({ type: "TAGS_CHANGED", description: "Customer tags updated" });
    if (changedPhone) events.push({ type: "PRIMARY_PHONE_CHANGED", description: "Primary phone changed. WhatsApp permission and contact windows were reset; new permission must be recorded for this number." });
    if (changedOptIn) events.push({ type: effectiveOptIn ? "OPT_IN" : "OPT_OUT", description: changedPhone ? "WhatsApp permission reset after primary phone changed" : effectiveOptIn ? `WhatsApp permission recorded: ${data.whatsappOptInSource}` : "WhatsApp permission withdrawn" });
    else if (existing && existing.whatsappOptInSource !== data.whatsappOptInSource) events.push({ type: "CONSENT_UPDATED", description: "WhatsApp permission source updated" });
    await tx.activityLog.createMany({ data: events.map(event => ({ ...event, customerId: customer.id, userId: actor.id, entityType: "Customer", entityId: customer.id })) });
    await tx.auditLog.create({ data: { userId: actor.id, action: existing ? "customer.updated" : "customer.created", entityType: "Customer", entityId: customer.id, metadata: { changedFields: existing ? Object.keys(values).filter(key => JSON.stringify(existing[key as keyof typeof existing]) !== JSON.stringify(values[key as keyof typeof values])) : ["created"] } } });
    return customer;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function updateCustomerOutcome(id: string, input: unknown, actor: Actor) {
  const data = z.object({ status: z.enum(["ACTIVE", "INACTIVE", "PROSPECT", "DO_NOT_CONTACT"]) }).strict().parse(input);
  return prisma.$transaction(async tx => {
    const customer = await tx.customer.findFirst({ where: { id, ...customerScope(actor), archivedAt: null } });
    if (!customer) throw new AppError(404, "Customer not found.");
    const updated = await tx.customer.update({ where: { id, ...customerScope(actor), archivedAt: null }, data: { status: data.status, ...(data.status === "DO_NOT_CONTACT" && { whatsappOptIn: false, whatsappOptOutAt: new Date(), whatsappOptOutReason: "Do not contact requested" }) } });
    await tx.activityLog.create({ data: { customerId: id, userId: actor.id, type: "CUSTOMER_STATUS_CHANGED", description: `Customer status changed to ${data.status.toLowerCase().replaceAll("_", " ")}` } });
    if (customer.whatsappOptIn && data.status === "DO_NOT_CONTACT") await tx.activityLog.create({ data: { customerId: id, userId: actor.id, type: "OPT_OUT", description: "WhatsApp permission withdrawn: do not contact requested" } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "customer.status.updated", entityType: "Customer", entityId: id, metadata: { previousStatus: customer.status, status: data.status } } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function bulkCustomers(input: unknown, actor: Actor) {
  assertRole(actor, "ADMIN", "MANAGER");
  const { ids: rawIds, action, value, tagIds = [] } = bulkCustomerSchema.parse(input);
  const ids = [...new Set(rawIds)];
  if (action === "archive" || (action === "status" && value === "ARCHIVED")) assertRole(actor, "ADMIN");
  return prisma.$transaction(async tx => {
    const customers = await tx.customer.findMany({ where: { id: { in: ids }, ...customerScope(actor), archivedAt: null }, select: { id: true, whatsappOptIn: true } });
    if (customers.length !== ids.length) throw new AppError(422, "Some selected customers are unavailable or archived. Refresh your selection.");
    const update: Prisma.CustomerUncheckedUpdateManyInput = {};
    if (action === "assign") { await validateRelations(tx, { assignedUserId: value }); update.assignedUserId = value || null; }
    if (action === "customerType") { await validateRelations(tx, { customerTypeId: value }); update.customerTypeId = value || null; }
    if (action === "area") { await validateRelations(tx, { areaId: value }); update.areaId = value || null; }
    if (action === "route") { await validateRelations(tx, { routeId: value }); update.routeId = value || null; }
    if (action === "status") {
      const status = z.enum(["ACTIVE", "INACTIVE", "PROSPECT", "DO_NOT_CONTACT", "ARCHIVED"]).parse(value);
      update.status = status;
      if (status === "DO_NOT_CONTACT" || status === "ARCHIVED") Object.assign(update, { whatsappOptIn: false, whatsappOptOutAt: new Date(), whatsappOptOutReason: status === "ARCHIVED" ? "Customer archived" : "Do not contact requested" });
      if (status === "ARCHIVED") update.archivedAt = new Date();
    }
    if (action === "archive") Object.assign(update, { status: "ARCHIVED", archivedAt: new Date(), whatsappOptIn: false, whatsappOptOutAt: new Date(), whatsappOptOutReason: "Customer archived" });
    if (action === "addTags" || action === "removeTags") {
      if (!tagIds.length) throw new AppError(422, "Select at least one tag.");
      if (action === "addTags") { await validateRelations(tx, { tagIds }); await tx.customerTag.createMany({ data: ids.flatMap(customerId => [...new Set(tagIds)].map(tagId => ({ customerId, tagId }))), skipDuplicates: true }); }
      else await tx.customerTag.deleteMany({ where: { customerId: { in: ids }, tagId: { in: tagIds } } });
      await tx.customer.updateMany({ where: { id: { in: ids } }, data: { updatedAt: new Date() } });
    } else await tx.customer.updateMany({ where: { id: { in: ids } }, data: update });
    const descriptions: Record<typeof action, string> = { assign: "Customer assignment changed", status: `Customer status changed to ${value?.toLowerCase().replaceAll("_", " ")}`, addTags: "Customer tags added", removeTags: "Customer tags removed", customerType: "Customer type changed", area: "Customer area changed", route: "Customer route changed", archive: "Customer archived" };
    await tx.activityLog.createMany({ data: ids.map(customerId => ({ customerId, userId: actor.id, type: `CUSTOMER_${action.toUpperCase()}`, description: descriptions[action] })) });
    if (action === "archive" || (action === "status" && ["DO_NOT_CONTACT", "ARCHIVED"].includes(value || ""))) await tx.activityLog.createMany({ data: customers.filter(customer => customer.whatsappOptIn).map(customer => ({ customerId: customer.id, userId: actor.id, type: "OPT_OUT", description: "WhatsApp permission withdrawn after customer status changed" })) });
    await tx.auditLog.create({ data: { userId: actor.id, action: `customer.bulk.${action}`, entityType: "Customer", metadata: { ids, value, tagIds } } });
    return { updated: ids.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
