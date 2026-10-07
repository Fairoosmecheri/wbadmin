import { type CampaignRecipient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { exclusionReason, renderedPayloadSchema, templateProblem } from "./validation";
import { refreshCampaignCounts } from "./service";
import { assertUsableTemplate } from "@/modules/templates/service";
import { getWhatsAppProvider, providerMode, WhatsAppProviderError, type WhatsAppProvider } from "@/modules/whatsapp/provider";
import { replayPendingWebhooks } from "@/modules/whatsapp/webhooks";

import { campaignFingerprint } from "./fingerprint";

export const CLAIM_LEASE_MS = 300000;
export function queueConfiguration() {
  return { batchSize: Math.max(1, Math.min(100, Number(process.env.WHATSAPP_SEND_BATCH_SIZE) || 25)), rate: Math.max(1, Math.min(80, Number(process.env.WHATSAPP_SEND_RATE_LIMIT) || 5)) };
}
export async function promoteScheduledCampaigns() {
  return prisma.campaign.updateMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, data: { status: "QUEUED" } });
}
export async function claimRecipients(limit = queueConfiguration().batchSize, campaignId?: string): Promise<CampaignRecipient[]> {
  const take = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await prisma.$queryRaw<CampaignRecipient[]>`WITH candidates AS (
    SELECT r.id FROM "CampaignRecipient" r JOIN "Campaign" c ON c.id = r."campaignId"
    WHERE (${campaignId ?? null}::text IS NULL OR r."campaignId" = ${campaignId ?? null}) AND r.status = 'QUEUED' AND r."providerAttemptedAt" IS NULL AND c.status IN ('QUEUED','SENDING')
      AND (r."nextAttemptAt" IS NULL OR r."nextAttemptAt" <= NOW())
    ORDER BY r."createdAt", r.id FOR UPDATE OF r SKIP LOCKED LIMIT ${take}
  ) UPDATE "CampaignRecipient" r SET status = 'PROCESSING', "claimedAt" = NOW(), "updatedAt" = NOW()
    FROM candidates WHERE r.id = candidates.id RETURNING r.*`;
  if (rows.length) await prisma.campaign.updateMany({ where: { id: { in: [...new Set(rows.map(r => r.campaignId))] }, status: "QUEUED" }, data: { status: "SENDING", startedAt: new Date() } });
  return rows;
}
/** Reclaim only jobs that provably never attempted a provider call. Unknown results require review. */
export async function recoverExpiredClaims(now = new Date()) {
  const stale = new Date(now.getTime() - CLAIM_LEASE_MS);
  const recovered = await prisma.$queryRaw<Array<{ id: string; campaignId: string; status: string }>>`UPDATE "CampaignRecipient" SET
    status = CASE WHEN "providerAttemptedAt" IS NULL THEN 'QUEUED'::"CampaignRecipientStatus" ELSE 'FAILED'::"CampaignRecipientStatus" END,
    "failureReason" = CASE WHEN "providerAttemptedAt" IS NULL THEN NULL ELSE 'Send outcome unknown after worker interruption. Check Meta delivery records before any manual resend.' END,
    "failedAt" = CASE WHEN "providerAttemptedAt" IS NULL THEN NULL ELSE ${now}::timestamp END,
    "claimedAt" = NULL, "updatedAt" = NOW()
    WHERE status = 'PROCESSING' AND "claimedAt" < ${stale} RETURNING id, "campaignId", status`;
  for (const row of recovered) if (row.status === "FAILED") await prisma.message.updateMany({ where: { id: `campaign:${row.id}`, status: "QUEUED" }, data: { status: "FAILED", failedAt: now, errorCode: "OUTCOME_UNKNOWN", errorMessage: "Send outcome unknown after worker interruption; manual review required." } });
  for (const id of [...new Set(recovered.map(r => r.campaignId))]) await prisma.$transaction(tx => refreshCampaignCounts(tx, id));
  return recovered.length;
}
/** Shared PostgreSQL rate clock also coordinates multiple worker processes. */
async function reserveRateSlot() {
  const rate = queueConfiguration().rate;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(187646, 42)`;
    const setting = await tx.setting.findUnique({ where: { key: "campaign.sendRateClock" } });
    const old = setting?.value as { nextAt?: number } | undefined;
    const now = Date.now(); const slot = Math.max(now, (old?.nextAt || now));
    await tx.setting.upsert({ where: { key: "campaign.sendRateClock" }, create: { key: "campaign.sendRateClock", value: { nextAt: slot + Math.ceil(1000 / rate) } }, update: { value: { nextAt: slot + Math.ceil(1000 / rate) } } });
    return Math.max(0, slot - now);
  });
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function processRecipient(claim: CampaignRecipient, provider: WhatsAppProvider = getWhatsAppProvider()) {
  const wait = await reserveRateSlot(); if (wait) await pause(wait);
  const prepared = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${claim.campaignId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CampaignRecipient" WHERE id = ${claim.id} FOR UPDATE`;
    const recipient = await tx.campaignRecipient.findUnique({ where: { id: claim.id }, include: { customer: true, campaign: { include: { template: true } } } });
    if (!recipient || recipient.status !== "PROCESSING" || recipient.providerAttemptedAt || recipient.claimedAt?.getTime() !== claim.claimedAt?.getTime()) return null;
    const campaign = recipient.campaign;
    if (!["QUEUED", "SENDING"].includes(campaign.status)) {
      await tx.campaignRecipient.update({ where: { id: recipient.id }, data: { status: campaign.status === "CANCELLED" ? "CANCELLED" : "QUEUED", claimedAt: null } });
      await refreshCampaignCounts(tx, campaign.id); return null;
    }
    let reason: string | null = exclusionReason(recipient.customer);
    if (recipient.customer.phoneNormalized !== recipient.phone) reason = "Customer phone changed since the campaign was confirmed.";
    const parsed = renderedPayloadSchema.safeParse(recipient.renderedPayload);
    if (!parsed.success) reason = "The saved template payload is invalid.";
    const problem = templateProblem(campaign.template); if (problem) reason = problem;
    try { assertUsableTemplate(campaign.template); } catch (error) { reason = error instanceof Error ? error.message : "Template is no longer permitted."; }
    if (parsed.success && (parsed.data.sourceBody !== campaign.template.body || parsed.data.name !== campaign.template.name || parsed.data.language !== campaign.template.language)) reason = "Template changed after confirmation. Review a new campaign before sending.";
    if (parsed.success && (parsed.data.providerMode !== providerMode() || parsed.data.templateFingerprint !== campaignFingerprint(campaign.template, campaign.variableMapping))) reason = "Template content or provider mode changed since confirmation. Create and review a new campaign.";
    if (reason || !parsed.success) {
      await tx.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SKIPPED", failureReason: reason || "Invalid payload", claimedAt: null } });
      await refreshCampaignCounts(tx, campaign.id); return null;
    }
    const now = new Date();
    const conversation = await tx.conversation.upsert({ where: { customerId: recipient.customerId }, create: { customerId: recipient.customerId, assignedUserId: recipient.customer.assignedUserId }, update: {} });
    await tx.message.upsert({ where: { id: `campaign:${recipient.id}` }, create: { id: `campaign:${recipient.id}`, conversationId: conversation.id, customerId: recipient.customerId, direction: "OUTBOUND", type: "TEMPLATE", textContent: parsed.data.body, templateName: parsed.data.name, status: "QUEUED" }, update: { status: "QUEUED", errorCode: null, errorMessage: null, failedAt: null } });
    // Commit before crossing the network boundary: a crash after this marker is never blindly retried.
    await tx.campaignRecipient.update({ where: { id: recipient.id }, data: { providerAttemptedAt: now, claimedAt: now, attempts: { increment: 1 } } });
    return { payload: parsed.data, phone: recipient.phone, customerId: recipient.customerId, conversationId: conversation.id, attempts: recipient.attempts + 1 };
  }, { timeout: 20000 });
  if (!prepared) return;
  let result: { whatsappMessageId: string };
  try { result = await provider.sendTemplateMessage({ ...prepared.payload, to: prepared.phone }); }
  catch (error) {
    // Only explicit, unambiguous provider rejections can be retried. Transport errors may have sent.
    const known = error instanceof WhatsAppProviderError;
    const retry = known && error.retryable && !error.ambiguous && prepared.attempts < 5;
    const ambiguous = !known || error.ambiguous;
    const reason = ambiguous ? "Send outcome unknown. Review provider records before any manual resend." : known ? error.message : "Message could not be sent.";
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${claim.campaignId} FOR UPDATE`;
      const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: claim.campaignId } });
      const canRetry = retry && campaign.status !== "CANCELLED";
      await tx.campaignRecipient.updateMany({ where: { id: claim.id, status: "PROCESSING" }, data: { status: canRetry ? "QUEUED" : "FAILED", failureReason: reason, failedAt: canRetry ? null : new Date(), claimedAt: null, ...(canRetry ? { providerAttemptedAt: null, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 10000 * 2 ** (prepared.attempts - 1)) + Math.floor(Math.random() * 1000)) } : {}) } });
      await tx.message.updateMany({ where: { id: `campaign:${claim.id}`, status: "QUEUED" }, data: { status: canRetry ? "QUEUED" : "FAILED", failedAt: canRetry ? null : new Date(), errorCode: ambiguous ? "OUTCOME_UNKNOWN" : known ? error.code : "FAILED", errorMessage: reason } });
      await refreshCampaignCounts(tx, claim.campaignId);
    }); return;
  }
  // If persistence fails after provider success, leave the attempted marker for conservative recovery.
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${claim.campaignId} FOR UPDATE`;
    const now = new Date();
    await tx.campaignRecipient.update({ where: { id: claim.id }, data: { status: "SENT", whatsappMessageId: result.whatsappMessageId, sentAt: now, claimedAt: null, failureReason: null, failedAt: null, nextAttemptAt: null } });
    await tx.message.update({ where: { id: `campaign:${claim.id}` }, data: { whatsappMessageId: result.whatsappMessageId, status: "SENT", sentAt: now, errorCode: null, errorMessage: null, failedAt: null } });
    await tx.conversation.update({ where: { id: prepared.conversationId }, data: { lastMessageAt: now } });
    await tx.customer.update({ where: { id: prepared.customerId }, data: { lastContactedAt: now, lastBusinessMessageAt: now, lastCampaignAt: now } });
    await tx.activityLog.create({ data: { customerId: prepared.customerId, type: "CAMPAIGN_SENT", entityType: "Campaign", entityId: claim.campaignId, description: "WhatsApp campaign message sent." } });
    await refreshCampaignCounts(tx, claim.campaignId);
  }, { timeout: 20000 });
  await replayPendingWebhooks(25);
}
export async function runCampaignBatch() {
  await promoteScheduledCampaigns(); await recoverExpiredClaims();
  const claims = await claimRecipients();
  for (const claim of claims) {
    try { await processRecipient(claim); } catch (error) { console.error("Campaign recipient processing failed", { recipientId: claim.id, type: error instanceof Error ? error.name : "UnknownError" }); }
  }
  return claims.length;
}
