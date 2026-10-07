import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { assertRole, type Actor } from "@/lib/authorization";
import { buildCustomerWhere } from "@/modules/customers/filters";
import { cleanCustomerFilter, savedViewInputSchema, segmentInputSchema } from "./validation";

const referencesSchema = z.object({ segmentId: z.string().min(1).max(100).optional(), viewId: z.string().min(1).max(100).optional() });
const jsonFilter = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;

/** Resolve a dynamic segment/private view and combine explicit URL filter overrides. */
export async function resolveCustomerFilter(input: unknown, actor: Actor) {
  const references = referencesSchema.parse(input);
  if (references.segmentId && references.viewId) throw new AppError(422, "Choose either a segment or a saved view.");
  let base = {};
  if (references.segmentId) {
    assertRole(actor, "ADMIN", "MANAGER");
    const segment = await prisma.segment.findUnique({ where: { id: references.segmentId }, select: { filterDefinition: true } });
    if (!segment) throw new AppError(404, "Segment not found.");
    base = cleanCustomerFilter(segment.filterDefinition);
  }
  if (references.viewId) {
    const view = await prisma.savedCustomerView.findFirst({ where: { id: references.viewId, userId: actor.id }, select: { filterDefinition: true } });
    if (!view) throw new AppError(404, "Saved view not found.");
    base = cleanCustomerFilter(view.filterDefinition);
  }
  return cleanCustomerFilter({ ...base, ...cleanCustomerFilter(input) });
}

/** Live actor-scoped membership. Campaigns must snapshot eligible recipients at launch. */
export async function previewSegment(filterDefinition: unknown, actor: Actor, limit = 12) {
  const filter = await resolveCustomerFilter(filterDefinition, actor);
  const where = buildCustomerWhere(filter, actor);
  const take = z.number().int().min(1).max(100).parse(limit);
  const [total, customers] = await prisma.$transaction([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, take, orderBy: [{ businessName: "asc" }, { id: "asc" }], select: {
      id: true, businessName: true, customerCode: true, phoneNormalized: true, status: true, whatsappOptIn: true,
      customerType: { select: { name: true } }, area: { select: { name: true } }, assignedUser: { select: { name: true } },
    } }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return { total, customers, filterDefinition: filter };
}

export async function listSegments(actor: Actor) {
  assertRole(actor, "ADMIN", "MANAGER");
  const segments = await prisma.segment.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }], include: { createdByUser: { select: { name: true } } } });
  return Promise.all(segments.map(async segment => ({ ...segment, count: await prisma.customer.count({ where: buildCustomerWhere(segment.filterDefinition, actor) }) })));
}

export async function getSegment(id: string, actor: Actor) {
  assertRole(actor, "ADMIN", "MANAGER");
  const segment = await prisma.segment.findUnique({ where: { id }, include: { createdByUser: { select: { name: true } } } });
  if (!segment) throw new AppError(404, "Segment not found.");
  return { ...segment, preview: await previewSegment(segment.filterDefinition, actor) };
}

export async function saveSegment(input: unknown, actor: Actor, id?: string) {
  assertRole(actor, "ADMIN", "MANAGER");
  const data = segmentInputSchema.parse(input);
  const filterDefinition = jsonFilter(await resolveCustomerFilter(data.filterDefinition, actor));
  return prisma.$transaction(async tx => {
    const values = { name: data.name, description: data.description || null, filterDefinition };
    const segment = id ? await tx.segment.update({ where: { id }, data: values }) : await tx.segment.create({ data: { ...values, createdBy: actor.id } });
    await tx.auditLog.create({ data: { userId: actor.id, action: id ? "segment.updated" : "segment.created", entityType: "Segment", entityId: segment.id } });
    return segment;
  });
}

export async function duplicateSegment(id: string, actor: Actor) {
  assertRole(actor, "ADMIN", "MANAGER");
  const source = await prisma.segment.findUnique({ where: { id } });
  if (!source) throw new AppError(404, "Segment not found.");
  return saveSegment({ name: `${source.name.slice(0, 93)} (copy)`, description: source.description, filterDefinition: source.filterDefinition }, actor);
}

export async function deleteSegment(id: string, actor: Actor) {
  assertRole(actor, "ADMIN", "MANAGER");
  await prisma.$transaction(async tx => {
    await tx.segment.delete({ where: { id } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "segment.deleted", entityType: "Segment", entityId: id } });
  });
  return { deleted: true };
}

export async function listSavedViews(actor: Actor) {
  const views = await prisma.savedCustomerView.findMany({ where: { userId: actor.id }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
  return Promise.all(views.map(async view => ({ ...view, count: await prisma.customer.count({ where: buildCustomerWhere(view.filterDefinition, actor) }) })));
}

export async function getSavedView(id: string, actor: Actor) {
  const view = await prisma.savedCustomerView.findFirst({ where: { id, userId: actor.id } });
  if (!view) throw new AppError(404, "Saved view not found.");
  return { ...view, preview: await previewSegment(view.filterDefinition, actor) };
}

export async function saveSavedView(input: unknown, actor: Actor, id?: string) {
  const data = savedViewInputSchema.parse(input);
  const filterDefinition = jsonFilter(await resolveCustomerFilter(data.filterDefinition, actor));
  const values = { name: data.name, filterDefinition };
  // Include ownership in the mutation itself, so foreign IDs never expose or alter views.
  return id
    ? prisma.savedCustomerView.update({ where: { id, userId: actor.id }, data: values })
    : prisma.savedCustomerView.create({ data: { ...values, userId: actor.id } });
}

export async function deleteSavedView(id: string, actor: Actor) {
  await prisma.savedCustomerView.delete({ where: { id, userId: actor.id } });
  return { deleted: true };
}
