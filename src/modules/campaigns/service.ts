import { Prisma, type CampaignRecipientStatus, type ResponseClassification, type Template } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { assertRole, type Actor } from "@/lib/authorization";
import { buildCustomerWhere } from "@/modules/customers/filters";
import { resolveCustomerFilter } from "@/modules/segments/service";
import { getWhatsAppProvider, providerMode, WhatsAppProviderError } from "@/modules/whatsapp/provider";
import { assertUsableTemplate } from "@/modules/templates/service";
import { normalizePhone } from "@/modules/customers/phone";
import { campaignInputSchema, classificationSchema, exclusionReason, launchSchema, renderCampaignPayload, templateProblem, transitionAllowed, variableMappingSchema, type VariableMapping } from "./validation";

import { campaignFingerprint } from "./fingerprint";

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const access = (actor: Actor) => assertRole(actor, "ADMIN", "MANAGER");
export const campaignInclude = { template: true, segment: { select: { id: true, name: true } }, createdByUser: { select: { name: true } } } satisfies Prisma.CampaignInclude;
export async function campaignOptions(actor: Actor) {
  access(actor);
  const [templates, segments, areas, routes, customerTypes, tags, users] = await Promise.all([
    prisma.template.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" } }),
    prisma.segment.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), prisma.area.findMany({ where: { active: true } }), prisma.route.findMany({ where: { active: true } }), prisma.customerType.findMany({ where: { active: true } }), prisma.tag.findMany({ where: { active: true } }), prisma.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  return { templates: templates.filter(t => { try { assertUsableTemplate(t); return !templateProblem(t); } catch { return false; } }), segments, areas, routes, customerTypes, tags, users, provider: providerMode(), testNumbers: (process.env.WHATSAPP_TEST_NUMBERS || "").split(",").map(s => s.trim()).filter(Boolean) };
}
export async function getCampaign(id: string, actor: Actor) {
  access(actor); const campaign = await prisma.campaign.findUnique({ where: { id }, include: campaignInclude });
  if (!campaign) throw new AppError(404, "Campaign not found."); return campaign;
}
export async function listCampaigns(input: unknown, actor: Actor) {
  access(actor); const q = z.object({ page: z.coerce.number().int().min(1).default(1), search: z.string().max(120).default(""), status: z.enum(["DRAFT", "SCHEDULED", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"]).optional() }).parse(input);
  const where: Prisma.CampaignWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.search ? { name: { contains: q.search, mode: "insensitive" } } : {}) };
  const [total, campaigns] = await prisma.$transaction([prisma.campaign.count({ where }), prisma.campaign.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * 25, take: 25, include: campaignInclude })]);
  return { campaigns, total, page: q.page, pageSize: 25 };
}
export async function saveCampaign(input: unknown, actor: Actor, id?: string) {
  access(actor); const data = campaignInputSchema.parse(input);
  const filter = await resolveCustomerFilter(data.segmentId ? { segmentId: data.segmentId } : data.filterDefinition, actor);
  const template = await prisma.template.findUnique({ where: { id: data.templateId } });
  if (!template) throw new AppError(422, "Select a template."); assertUsableTemplate(template); const problem = templateProblem(template); if (problem) throw new AppError(422, problem);
  try { renderCampaignPayload(template, data.variableMapping, { contactPerson: "Sample contact", businessName: "Sample business", customerCode: "SAMPLE" }); } catch (error) { throw new AppError(422, (error as Error).message); }
  return prisma.$transaction(async tx => {
    if (id) { await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${id} FOR UPDATE`; const existing = await tx.campaign.findUnique({ where: { id } }); if (!existing || existing.status !== "DRAFT") throw new AppError(409, "Only a draft campaign can be edited."); }
    const values = { name: data.name, description: data.description || null, templateId: data.templateId, segmentId: data.segmentId || null, filterDefinition: json(filter), variableMapping: json(data.variableMapping), previewedAt: null, testSentAt: null, audienceSummary: {} };
    const campaign = id ? await tx.campaign.update({ where: { id }, data: values }) : await tx.campaign.create({ data: { ...values, createdByUserId: actor.id } });
    await tx.auditLog.create({ data: { userId: actor.id, action: id ? "campaign.updated" : "campaign.created", entityType: "Campaign", entityId: campaign.id } }); return campaign;
  });
}
export type AudienceSummary = { matched: number; eligible: number; excluded: number; optedOut: number; noConsent: number; invalidPhone: number; archived: number; inactive: number; duplicatesRemoved: number; missingVariables: number };
async function collectAudience(tx: Prisma.TransactionClient, filter: unknown, actor: Actor, template?: Template, mapping?: VariableMapping, campaignId?: string) {
  const summary: AudienceSummary = { matched: 0, eligible: 0, excluded: 0, optedOut: 0, noConsent: 0, invalidPhone: 0, archived: 0, inactive: 0, duplicatesRemoved: 0, missingVariables: 0 };
  const samples: Array<{ id: string; businessName: string; phone: string; body?: string }> = []; let cursor: string | undefined; const phones = new Set<string>();
  for (;;) {
    const customers = await tx.customer.findMany({ where: buildCustomerWhere(filter, actor), orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, phoneNormalized: true, businessName: true, contactPerson: true, customerCode: true, whatsappOptIn: true, whatsappOptOutAt: true, archivedAt: true, status: true } });
    if (!customers.length) break;
    const recipients: Prisma.CampaignRecipientCreateManyInput[] = [];
    for (const customer of customers) {
      summary.matched++; const reason = exclusionReason(customer);
      if (reason) { summary[reason]++; summary.excluded++; continue; }
      if (phones.has(customer.phoneNormalized)) { summary.duplicatesRemoved++; summary.excluded++; continue; } phones.add(customer.phoneNormalized);
      let payload;
      try { if (template && mapping) payload = renderCampaignPayload(template, mapping, customer); } catch { summary.missingVariables++; summary.excluded++; continue; }
      summary.eligible++;
      if (samples.length < 5) samples.push({ id: customer.id, businessName: customer.businessName, phone: customer.phoneNormalized, body: payload?.body });
      if (campaignId && payload) recipients.push({ campaignId, customerId: customer.id, phone: customer.phoneNormalized, renderedPayload: json({ ...payload, providerMode: providerMode(), templateFingerprint: campaignFingerprint(template!, mapping) }), queuedAt: new Date() });
    }
    if (recipients.length) await tx.campaignRecipient.createMany({ data: recipients, skipDuplicates: true });
    cursor = customers.at(-1)!.id;
  }
  return { summary, samples };
}
export async function previewAudience(input: unknown, actor: Actor) {
  access(actor); const data = z.object({ segmentId: z.string().nullable().optional(), filterDefinition: z.record(z.string(), z.unknown()).default({}) }).parse(input);
  const filter = await resolveCustomerFilter(data.segmentId ? { segmentId: data.segmentId } : data.filterDefinition, actor);
  return prisma.$transaction(tx => collectAudience(tx, filter, actor), { isolationLevel: "RepeatableRead", timeout: 60000 });
}
export async function previewCampaign(id: string, actor: Actor) {
  access(actor);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${id} FOR UPDATE`;
    const campaign = await tx.campaign.findUnique({ where: { id }, include: { template: true } });
    if (!campaign || campaign.status !== "DRAFT") throw new AppError(409, "Only draft campaigns can be previewed.");
    assertUsableTemplate(campaign.template); const problem = templateProblem(campaign.template); if (problem) throw new AppError(422, problem);
    const result = await collectAudience(tx, campaign.filterDefinition, actor, campaign.template, variableMappingSchema.parse(campaign.variableMapping));
    await tx.campaign.update({ where: { id }, data: { audienceSummary: json({ ...result.summary, previewFingerprint: campaignFingerprint(campaign.template, campaign.variableMapping) }), previewedAt: new Date(), testSentAt: null } }); return result;
  }, { isolationLevel: "RepeatableRead", timeout: 60000 });
}
export async function testCampaign(id: string, input: unknown, actor: Actor) {
  access(actor); const data = z.object({ phone: z.string().min(1).max(60) }).parse(input);
  let phone: string; try { phone = normalizePhone(data.phone); } catch { throw new AppError(422, "Enter a valid test phone number."); }
  const allowed = (process.env.WHATSAPP_TEST_NUMBERS || "").split(",").map(value => { try { return normalizePhone(value); } catch { return ""; } });
  if (providerMode() === "cloud" && !allowed.includes(phone)) throw new AppError(403, "This number is not in the administrator-configured WHATSAPP_TEST_NUMBERS list.");
  const campaign = await getCampaign(id, actor);
  if (campaign.status !== "DRAFT" || !campaign.previewedAt) throw new AppError(409, "Preview this draft before a test send.");
  assertUsableTemplate(campaign.template); const problem = templateProblem(campaign.template); if (problem) throw new AppError(422, problem);
  const reviewed = campaign.audienceSummary as Record<string, unknown>;
  if (reviewed.previewFingerprint !== campaignFingerprint(campaign.template, campaign.variableMapping)) throw new AppError(409, "The template or provider mode changed. Preview and test the updated draft.");
  const sample = await prisma.customer.findFirst({ where: { AND: [buildCustomerWhere(campaign.filterDefinition, actor), { whatsappOptIn: true, whatsappOptOutAt: null, archivedAt: null, status: "ACTIVE" }] }, orderBy: { id: "asc" } });
  if (!sample) throw new AppError(422, "The audience has no eligible sample customer.");
  const payload = renderCampaignPayload(campaign.template, variableMappingSchema.parse(campaign.variableMapping), sample);
  let sent: { whatsappMessageId: string };
  try { sent = await getWhatsAppProvider().sendTemplateMessage({ ...payload, to: phone }); } catch (error) { if (error instanceof WhatsAppProviderError) throw new AppError(502, error.message); throw error; }
  await prisma.auditLog.create({ data: { userId: actor.id, action: "campaign.test_sent", entityType: "Campaign", entityId: id, metadata: { whatsappMessageId: sent.whatsappMessageId, providerMode: providerMode() } } });
  const now = new Date();
  const changed = await prisma.campaign.updateMany({ where: { id, status: "DRAFT", updatedAt: campaign.updatedAt }, data: { testSentAt: now } });
  if (!changed.count) throw new AppError(409, "The draft changed during testing. Preview and test the current draft again.");
  return { sent: true, mode: providerMode() };
}
export async function launchCampaign(id: string, input: unknown, actor: Actor) {
  access(actor); const data = launchSchema.parse(input);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${id} FOR UPDATE`;
    const campaign = await tx.campaign.findUnique({ where: { id }, include: { template: true } });
    if (!campaign) throw new AppError(404, "Campaign not found.");
    if (data.confirmation !== `SEND ${campaign.name}`) throw new AppError(422, "Type the confirmation exactly as shown.");
    if (campaign.status !== "DRAFT") { if (campaign.confirmedAt) return campaign; throw new AppError(409, "This campaign can no longer be sent."); }
    if (!campaign.previewedAt || !campaign.testSentAt) throw new AppError(422, "Preview and test the current draft before sending.");
    assertUsableTemplate(campaign.template); const problem = templateProblem(campaign.template); if (problem) throw new AppError(422, problem);
    const reviewed = campaign.audienceSummary as Record<string, unknown>;
    if (reviewed.previewFingerprint !== campaignFingerprint(campaign.template, campaign.variableMapping)) throw new AppError(409, "The template or provider mode changed since review. Preview and test the current content before sending.");
    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() < Date.now() + 30000) throw new AppError(422, "Choose a schedule at least one minute in the future.");
    const result = await collectAudience(tx, campaign.filterDefinition, actor, campaign.template, variableMappingSchema.parse(campaign.variableMapping), id);
    if (!result.summary.eligible) throw new AppError(422, "There are no eligible recipients.");
    if (result.summary.eligible !== data.expectedEligible) throw new AppError(409, "Audience membership changed. Preview and review the updated count before confirming.");
    const updated = await tx.campaign.update({ where: { id }, data: { status: scheduledAt ? "SCHEDULED" : "QUEUED", scheduledAt, confirmedAt: new Date(), totalRecipients: result.summary.eligible, queuedCount: result.summary.eligible, audienceSummary: json(result.summary) } });
    await tx.auditLog.create({ data: { userId: actor.id, action: scheduledAt ? "campaign.scheduled" : "campaign.queued", entityType: "Campaign", entityId: id, metadata: { recipients: result.summary.eligible } } }); return updated;
  }, { timeout: 120000 });
}
export async function refreshCampaignCounts(tx: Prisma.TransactionClient, campaignId: string) {
  await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
  const rows = await tx.$queryRaw<Array<{ queued: bigint; sent: bigint; delivered: bigint; read: bigint; failed: bigint; replied: bigint; interested: bigint; orders: bigint }>>`SELECT COUNT(*) FILTER (WHERE status IN ('QUEUED','PROCESSING')) AS queued, COUNT("sentAt") AS sent, COUNT("deliveredAt") AS delivered, COUNT("readAt") AS read, COUNT(*) FILTER (WHERE status = 'FAILED') AS failed, COUNT("repliedAt") AS replied, COUNT(*) FILTER (WHERE "responseClassification" = 'INTERESTED') AS interested, COUNT(*) FILTER (WHERE "responseClassification" = 'ORDER_CONFIRMED') AS orders FROM "CampaignRecipient" WHERE "campaignId" = ${campaignId}`;
  const r = rows[0]; const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  await tx.campaign.update({ where: { id: campaignId }, data: { queuedCount: Number(r.queued), sentCount: Number(r.sent), deliveredCount: Number(r.delivered), readCount: Number(r.read), failedCount: Number(r.failed), repliedCount: Number(r.replied), interestedCount: Number(r.interested), orderCount: Number(r.orders), ...(Number(r.queued) === 0 && ["QUEUED", "SENDING"].includes(campaign.status) ? { status: "COMPLETED", completedAt: new Date() } : {}) } });
}
export async function controlCampaign(id: string, action: string, actor: Actor) {
  access(actor);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${id} FOR UPDATE`;
    const campaign = await tx.campaign.findUnique({ where: { id } }); if (!campaign) throw new AppError(404, "Campaign not found.");
    if (!transitionAllowed(campaign.status, action)) throw new AppError(409, `Cannot ${action} a ${campaign.status.toLowerCase()} campaign.`);
    const status = action === "cancel" ? "CANCELLED" : action === "pause" ? "PAUSED" : campaign.scheduledAt && campaign.scheduledAt > new Date() ? "SCHEDULED" : "QUEUED";
    await tx.campaign.update({ where: { id }, data: { status, ...(action === "cancel" ? { completedAt: new Date() } : {}) } });
    if (action === "cancel") await tx.campaignRecipient.updateMany({ where: { campaignId: id, status: { in: ["QUEUED", "PROCESSING"] }, providerAttemptedAt: null }, data: { status: "CANCELLED", claimedAt: null, failureReason: "Cancelled before sending." } });
    await refreshCampaignCounts(tx, id);
    await tx.auditLog.create({ data: { userId: actor.id, action: `campaign.${action}`, entityType: "Campaign", entityId: id } }); return tx.campaign.findUniqueOrThrow({ where: { id } });
  });
}
export const recipientQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), status: z.enum(["QUEUED", "PROCESSING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED", "SKIPPED"]).optional(), classification: z.enum(["INTERESTED", "NOT_INTERESTED", "NEEDS_FOLLOWUP", "ORDER_CONFIRMED", "NO_RESPONSE", "OTHER"]).optional(), replied: z.enum(["true", "false"]).optional() });
export function recipientWhere(campaignId: string, input: unknown) { const q = recipientQuerySchema.parse(input); return { campaignId, ...(q.status ? { status: q.status as CampaignRecipientStatus } : {}), ...(q.classification ? { responseClassification: q.classification as ResponseClassification } : {}), ...(q.replied ? { repliedAt: q.replied === "true" ? { not: null } : null } : {}) } satisfies Prisma.CampaignRecipientWhereInput; }
export async function listRecipients(id: string, input: unknown, actor: Actor) {
  await getCampaign(id, actor); const q = recipientQuerySchema.parse(input); const where = recipientWhere(id, q);
  const [total, recipients] = await prisma.$transaction([prisma.campaignRecipient.count({ where }), prisma.campaignRecipient.findMany({ where, orderBy: { id: "asc" }, take: 25, skip: (q.page - 1) * 25, include: { customer: { select: { id: true, businessName: true } } } })]);
  return { recipients, total, page: q.page, pageSize: 25 };
}
export async function classifyRecipient(campaignId: string, recipientId: string, input: unknown, actor: Actor) {
  access(actor); const data = classificationSchema.parse(input);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
    const recipient = await tx.campaignRecipient.findFirst({ where: { id: recipientId, campaignId } }); if (!recipient) throw new AppError(404, "Recipient not found.");
    const updated = await tx.campaignRecipient.update({ where: { id: recipientId }, data: { responseClassification: data.responseClassification, conversionMetadata: json({ orderReference: data.orderReference, orderValue: data.orderValue, currency: data.currency, notes: data.notes, recordedBy: actor.id, recordedAt: new Date().toISOString() }) } });
    if (data.responseClassification === "ORDER_CONFIRMED") await tx.customer.update({ where: { id: recipient.customerId }, data: { lastOrderDate: new Date() } });
    await tx.activityLog.create({ data: { customerId: recipient.customerId, userId: actor.id, type: "CAMPAIGN_RESPONSE", entityType: "Campaign", entityId: campaignId, description: `Campaign response marked ${data.responseClassification.toLowerCase().replaceAll("_", " ")}.` } });
    await refreshCampaignCounts(tx, campaignId); return updated;
  });
}
