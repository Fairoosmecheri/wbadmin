import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import type { Actor } from "@/lib/authorization";
import { accessibleCustomer } from "@/modules/followups/service";
import { noteSchema } from "@/modules/followups/validation";
import { canEditNote } from "@/modules/followups/policy";
import { getGeneralSettings } from "@/modules/auth/settings";

const author = { createdByUser: { select: { id: true, name: true } } };
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export async function listNotes(actor: Actor, customerId: string, query: unknown) {
  await accessibleCustomer(actor, customerId);
  const { page, limit } = pageSchema.parse(query);
  const [notes, total] = await prisma.$transaction([
    prisma.customerNote.findMany({ where: { customerId }, include: author, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: (page - 1) * limit }),
    prisma.customerNote.count({ where: { customerId } }),
  ]);
  const { timezone } = await getGeneralSettings();
  return { items: notes.map(note => ({ ...note, canEdit: canEditNote(actor, note.createdByUserId) })), total, page, pages: Math.max(1, Math.ceil(total / limit)), timezone };
}
export async function createNote(actor: Actor, customerId: string, input: unknown) {
  await accessibleCustomer(actor, customerId);
  const data = noteSchema.parse(input);
  return prisma.$transaction(async tx => {
    const note = await tx.customerNote.create({ data: { ...data, customerId, createdByUserId: actor.id }, include: author });
    await tx.activityLog.create({ data: { customerId, userId: actor.id, type: "NOTE_ADDED", entityType: "CustomerNote", entityId: note.id, description: "A customer note was added." } });
    return { ...note, canEdit: true };
  });
}
export async function updateNote(actor: Actor, customerId: string, noteId: string, input: unknown) {
  await accessibleCustomer(actor, customerId);
  const { content, updatedAt } = noteSchema.extend({ updatedAt: z.iso.datetime({ offset: true }).optional() }).parse(input);
  return prisma.$transaction(async tx => {
    const note = await tx.customerNote.findFirst({ where: { id: noteId, customerId } });
    if (!note) throw new AppError(404, "Note not found.");
    if (!canEditNote(actor, note.createdByUserId)) throw new AppError(403, "Only the author or an administrator can edit this note.");
    if (updatedAt && new Date(updatedAt).getTime() !== note.updatedAt.getTime()) throw new AppError(409, "This note changed. Refresh before saving.");
    const result = await tx.customerNote.updateMany({ where: { id: noteId, updatedAt: note.updatedAt }, data: { content } });
    if (result.count !== 1) throw new AppError(409, "This note changed. Refresh before saving.");
    await tx.activityLog.create({ data: { customerId, userId: actor.id, type: "NOTE_UPDATED", entityType: "CustomerNote", entityId: noteId, description: "A customer note was edited." } });
    return { ...await tx.customerNote.findUniqueOrThrow({ where: { id: noteId }, include: author }), canEdit: true };
  });
}
