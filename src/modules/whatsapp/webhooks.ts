import { createHash } from "node:crypto";
import { Prisma, type MessageStatus, type MessageType, type CampaignRecipientStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { normalizePhone } from "@/modules/customers/phone";
import { advanceStatus, isOptOut } from "./policy";
import { providerMode } from "./provider";
const envelopeSchema = z.object({ object: z.literal("whatsapp_business_account"), entry: z.array(z.object({ id: z.string().optional(), changes: z.array(z.object({ value: z.record(z.string(), z.unknown()) })) })) });
const statusSchema = z.object({ id: z.string().min(1), status: z.enum(["sent", "delivered", "read", "failed"]), timestamp: z.string().optional(), errors: z.array(z.object({ code: z.union([z.number(), z.string()]), title: z.string().optional() })).optional() });
const messageSchema = z.object({ id: z.string().min(1), from: z.string().min(1), timestamp: z.string().optional(), type: z.string(), text: z.object({ body: z.string() }).optional(), context: z.object({ id: z.string() }).optional() }).passthrough();
type EventPayload = { kind: "status" | "inbound"; value: Record<string, unknown>; displayName?: string; origin?: { source: "mock" | "cloud"; businessAccountId?: string; phoneNumberId?: string; signatureVerified: boolean } };
function eventTime(value: string | undefined) {
  const n = Number(value) * 1000;
  return new Date(Number.isFinite(n) && n > 0 ? Math.min(n, Date.now()) : Date.now());
}
async function refreshCampaign(tx: Prisma.TransactionClient, campaignId: string) {
  // Serialize aggregate writers so cumulative counters cannot drift under concurrent webhooks.
  await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
  const [sentCount, deliveredCount, readCount, failedCount, repliedCount] = await Promise.all([
    tx.campaignRecipient.count({ where: { campaignId, sentAt: { not: null } } }),
    tx.campaignRecipient.count({ where: { campaignId, deliveredAt: { not: null } } }),
    tx.campaignRecipient.count({ where: { campaignId, readAt: { not: null } } }),
    tx.campaignRecipient.count({ where: { campaignId, status: "FAILED" } }),
    tx.campaignRecipient.count({ where: { campaignId, repliedAt: { not: null } } }),
  ]);
  await tx.campaign.update({ where: { id: campaignId }, data: { sentCount, deliveredCount, readCount, failedCount, repliedCount } });
}
async function applyEvent(eventId: string): Promise<boolean> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "WebhookEvent" WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (event.processed) return true;
    const payload = event.payload as unknown as EventPayload;
    if (payload.kind === "status") {
      const status = statusSchema.parse(payload.value); const time = eventTime(status.timestamp);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${status.id}))::text`;
      const message = await tx.message.findUnique({ where: { whatsappMessageId: status.id } });
      const recipient = await tx.campaignRecipient.findUnique({ where: { whatsappMessageId: status.id } });
      if (!message && !recipient) {
        const testSend = await tx.auditLog.findFirst({ where: { action: "campaign.test_sent", metadata: { path: ["whatsappMessageId"], equals: status.id } }, select: { id: true } });
        if (testSend) { await tx.webhookEvent.update({ where: { id: eventId }, data: { processed: true, processedAt: new Date(), error: null } }); return true; }
        await tx.webhookEvent.update({ where: { id: eventId }, data: { error: "Awaiting outbound message persistence; replay will retry." } });
        return false;
      }
      if (recipient) await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${recipient.campaignId} FOR UPDATE`;
      const incoming = status.status.toUpperCase();
      const failure = status.errors?.[0];
      if (message) {
        const next = advanceStatus(message.status, incoming) as MessageStatus;
        const data: Prisma.MessageUpdateInput = { status: next };
        if (["SENT", "DELIVERED", "READ"].includes(incoming) && !message.sentAt) data.sentAt = time;
        if (["DELIVERED", "READ"].includes(incoming) && !message.deliveredAt) data.deliveredAt = time;
        if (incoming === "READ" && !message.readAt) data.readAt = time;
        if (next === "FAILED") { data.failedAt = message.failedAt ?? time; data.errorCode = String(failure?.code ?? "DELIVERY_FAILED"); data.errorMessage = failure?.title?.slice(0, 300) ?? "Message delivery failed."; }
        if (["DELIVERED", "READ"].includes(next)) { data.failedAt = null; data.errorCode = null; data.errorMessage = null; }
        await tx.message.update({ where: { id: message.id }, data });
        if (next !== message.status) await tx.activityLog.create({ data: { customerId: message.customerId, type: `WHATSAPP_${next}`, entityType: "Message", entityId: message.id, description: `WhatsApp message ${next.toLowerCase()}.` } });
      }
      if (recipient) {
        const next = advanceStatus(recipient.status, incoming) as CampaignRecipientStatus;
        const data: Prisma.CampaignRecipientUpdateInput = { status: next };
        if (["SENT", "DELIVERED", "READ"].includes(incoming) && !recipient.sentAt) data.sentAt = time;
        if (["DELIVERED", "READ"].includes(incoming) && !recipient.deliveredAt) data.deliveredAt = time;
        if (incoming === "READ" && !recipient.readAt) data.readAt = time;
        if (next === "FAILED") { data.failedAt = recipient.failedAt ?? time; data.failureReason = `Delivery failed (${failure?.code ?? "unknown"}).`; }
        if (["DELIVERED", "READ"].includes(next)) { data.failedAt = null; data.failureReason = null; }
        await tx.campaignRecipient.update({ where: { id: recipient.id }, data });
        await refreshCampaign(tx, recipient.campaignId);
      }
    } else {
      const inbound = messageSchema.parse(payload.value);
      const phone = normalizePhone(inbound.from.startsWith("+") ? inbound.from : `+${inbound.from}`);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))::text`;
      const time = eventTime(inbound.timestamp);
      const customer = await tx.customer.findUnique({ where: { phoneNormalized: phone } });
      if (!customer) {
        const old = await tx.unmatchedContact.findUnique({ where: { phoneNormalized: phone } });
        const messages = Array.isArray(old?.messages) ? old.messages : [];
        await tx.unmatchedContact.upsert({ where: { phoneNormalized: phone }, create: { phoneNormalized: phone, displayName: payload.displayName?.slice(0, 120), messages: [inbound] as Prisma.InputJsonValue, lastMessageAt: time }, update: { messages: [...messages.slice(-99), inbound] as Prisma.InputJsonValue, lastMessageAt: time, resolvedAt: null } });
      } else if (!await tx.message.findUnique({ where: { whatsappMessageId: inbound.id } })) {
        const days = Math.max(1, Math.min(30, Number(process.env.WHATSAPP_REPLY_ATTRIBUTION_DAYS) || 7));
        const recipient = await tx.campaignRecipient.findFirst({ where: { customerId: customer.id, ...(inbound.context?.id ? { whatsappMessageId: inbound.context.id } : { sentAt: { gte: new Date(time.getTime() - days * 86400000), lte: time } }) }, orderBy: { sentAt: "desc" } });
        // Match the worker's Campaign -> Recipient -> Customer lock order.
        if (recipient) await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${recipient.campaignId} FOR UPDATE`;
        const conversation = await tx.conversation.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id, assignedUserId: customer.assignedUserId, lastMessageAt: time, unreadCount: 1 }, update: { status: "OPEN", unreadCount: { increment: 1 } } });
        if (time > conversation.lastMessageAt) await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: time } });
        const supported: Record<string, MessageType> = { text: "TEXT", image: "IMAGE", document: "DOCUMENT", audio: "AUDIO", video: "VIDEO", location: "LOCATION", contacts: "CONTACT", interactive: "INTERACTIVE" };
        const attachment = inbound[inbound.type];
        const media = attachment && typeof attachment === "object" ? attachment as Record<string, unknown> : {};
        const text = inbound.text?.body ?? (typeof media.caption === "string" ? media.caption : undefined);
        const message = await tx.message.create({ data: { conversationId: conversation.id, customerId: customer.id, direction: "INBOUND", type: supported[inbound.type] ?? "UNKNOWN", whatsappMessageId: inbound.id, textContent: text?.slice(0, 10000), mediaId: typeof media.id === "string" ? media.id : undefined, mimeType: typeof media.mime_type === "string" ? media.mime_type : undefined, status: "RECEIVED", rawPayload: { ...inbound, _crm: payload.origin ?? { source: "mock", signatureVerified: false } } as Prisma.InputJsonValue, createdAt: time } });
        const optedOut = text && isOptOut(text);
        await tx.customer.update({ where: { id: customer.id }, data: { ...(!customer.lastCustomerMessageAt || time > customer.lastCustomerMessageAt ? { lastCustomerMessageAt: time } : {}), ...(!customer.lastContactedAt || time > customer.lastContactedAt ? { lastContactedAt: time } : {}), ...(optedOut ? { whatsappOptIn: false, whatsappOptOutAt: time, whatsappOptOutReason: "Customer requested opt-out by WhatsApp", status: "DO_NOT_CONTACT" } : {}) } });
        await tx.activityLog.create({ data: { customerId: customer.id, type: optedOut ? "WHATSAPP_OPT_OUT" : "WHATSAPP_INBOUND", entityType: "Message", entityId: message.id, description: optedOut ? "Customer opted out of WhatsApp messages." : "Customer sent a WhatsApp message." } });
        if (recipient && !recipient.repliedAt) {
          await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${recipient.campaignId} FOR UPDATE`;
          await tx.campaignRecipient.update({ where: { id: recipient.id }, data: { repliedAt: time } });
          await refreshCampaign(tx, recipient.campaignId);
        }
      }
    }
    await tx.webhookEvent.update({ where: { id: eventId }, data: { processed: true, processedAt: new Date(), error: null } });
    return true;
  }, { timeout: 20000 });
}
async function saveEvent(payload: EventPayload) {
  const id = payload.kind === "inbound" ? `in:${payload.value.id}` : `status:${payload.value.id}:${payload.value.status}:${payload.value.timestamp ?? ""}`;
  const externalEventId = createHash("sha256").update(id).digest("hex");
  await prisma.webhookEvent.createMany({ data: [{ externalEventId, eventType: payload.kind, payload: payload as unknown as Prisma.InputJsonValue }], skipDuplicates: true });
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { externalEventId } });
  if (event.processed) return true;
  try { return await applyEvent(event.id); }
  catch (error) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { error: error instanceof z.ZodError ? "Invalid event fields." : "Processing failed; retained for retry." } });
    throw error;
  }
}
export async function processWebhookPayload(payload: unknown, options: { requireScope?: boolean } = {}) {
  const envelope = envelopeSchema.parse(payload); let processed = 0; let deferred = 0;
  for (const entry of envelope.entry) for (const change of entry.changes) {
    const value = change.value;
    if (providerMode() === "cloud" || options.requireScope) {
      const metadata = value.metadata as { phone_number_id?: string } | undefined;
      if (!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || !process.env.WHATSAPP_PHONE_NUMBER_ID) throw new AppError(503, "Webhook account configuration is missing.");
      if (entry.id !== process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || metadata?.phone_number_id !== process.env.WHATSAPP_PHONE_NUMBER_ID) throw new AppError(403, "Webhook belongs to a different WhatsApp account or phone number.");
    }
    const origin: NonNullable<EventPayload["origin"]> = providerMode() === "cloud" || options.requireScope ? { source: "cloud", businessAccountId: entry.id, phoneNumberId: (value.metadata as { phone_number_id: string }).phone_number_id, signatureVerified: options.requireScope === true } : { source: "mock", signatureVerified: false };
    if (Array.isArray(value.statuses)) for (const raw of value.statuses) {
      const parsed = statusSchema.safeParse(raw);
      if (!parsed.success) continue;
      if (await saveEvent({ kind: "status", value: parsed.data, origin })) processed++; else deferred++;
    }
    if (Array.isArray(value.messages)) for (const raw of value.messages) {
      const parsed = messageSchema.safeParse(raw);
      if (!parsed.success) continue;
      const contacts = Array.isArray(value.contacts) ? value.contacts as { wa_id?: string; profile?: { name?: string } }[] : [];
      const displayName = contacts.find(contact => contact.wa_id === parsed.data.from)?.profile?.name;
      if (await saveEvent({ kind: "inbound", value: parsed.data, origin, ...(displayName ? { displayName } : {}) })) processed++; else deferred++;
    }
  }
  await prisma.setting.upsert({ where: { key: "whatsapp.lastWebhook" }, create: { key: "whatsapp.lastWebhook", value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
  return { processed, deferred };
}
export async function replayPendingWebhooks(limit = 100) {
  const events = await prisma.webhookEvent.findMany({ where: { processed: false }, orderBy: { updatedAt: "asc" }, take: Math.max(1, Math.min(limit, 500)), select: { id: true } });
  let processed = 0;
  for (const event of events) { try { if (await applyEvent(event.id)) processed++; } catch { await prisma.webhookEvent.update({ where: { id: event.id }, data: { error: "Replay failed; event retained." } }); } }
  return processed;
}
export async function processMockEvents(limit = 100) {
  if (providerMode() !== "mock") return 0;
  const events = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "MockEvent" WHERE "processedAt" IS NULL AND "dueAt" <= NOW() AND ("claimedAt" IS NULL OR "claimedAt" < NOW() - INTERVAL '2 minutes') ORDER BY "dueAt" FOR UPDATE SKIP LOCKED LIMIT ${Math.max(1, Math.min(limit, 500))}`;
    if (!rows.length) return [];
    await tx.mockEvent.updateMany({ where: { id: { in: rows.map(row => row.id) } }, data: { claimedAt: new Date() } });
    return tx.mockEvent.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: { dueAt: "asc" } });
  });
  for (const event of events) {
    try { await processWebhookPayload(event.payload); await prisma.mockEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } }); }
    catch { await prisma.mockEvent.update({ where: { id: event.id }, data: { claimedAt: null, dueAt: new Date(Date.now() + 30000), error: "Mock event processing failed; retry scheduled." } }); }
  }
  await replayPendingWebhooks();
  return events.length;
}
