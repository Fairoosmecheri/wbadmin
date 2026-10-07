import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { customerScope, assertRole, type Actor } from "@/lib/authorization";
import { serviceWindowOpen, templateVariables, renderTemplate } from "@/modules/whatsapp/policy";
import { getWhatsAppProvider, WhatsAppProviderError, providerMode } from "@/modules/whatsapp/provider";
import { replayPendingWebhooks } from "@/modules/whatsapp/webhooks";
import { assertUsableTemplate } from "@/modules/templates/service";
export async function listConversations(actor: Actor, params: URLSearchParams) {
  const filter = params.get("filter") ?? "all"; const search = params.get("search")?.slice(0, 100); const page = Math.max(1, Number(params.get("page")) || 1);
  const where: Prisma.ConversationWhereInput = { customer: { ...customerScope(actor), ...(search ? { OR: [{ businessName: { contains: search, mode: "insensitive" } }, { phoneNormalized: { contains: search } }, { contactPerson: { contains: search, mode: "insensitive" } }] } : {}) }, ...(filter === "mine" ? { assignedUserId: actor.id } : filter === "unassigned" ? { assignedUserId: null } : filter === "unread" ? { unreadCount: { gt: 0 } } : filter === "open" ? { status: "OPEN" } : filter === "closed" ? { status: "CLOSED" } : {}) };
  const [items, total] = await Promise.all([prisma.conversation.findMany({ where, include: { customer: { select: { id: true, businessName: true, contactPerson: true, phoneNormalized: true, tags: { include: { tag: true } } } }, assignedUser: { select: { name: true } }, messages: { take: 1, orderBy: { createdAt: "desc" }, select: { textContent: true, type: true, direction: true, status: true } } }, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], skip: (page - 1) * 25, take: 25 }), prisma.conversation.count({ where })]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / 25)) };
}
export async function getConversation(actor: Actor, id: string, before?: string | null) {
  const conversation = await prisma.conversation.findFirst({ where: { id, customer: customerScope(actor) }, include: { customer: { include: { customerType: true, area: true, route: true, assignedUser: { select: { id: true, name: true } }, tags: { include: { tag: true } }, followUps: { where: { status: "PENDING" }, orderBy: { dueAt: "asc" }, take: 1 } } }, assignedUser: { select: { id: true, name: true } } } });
  if (!conversation) throw new AppError(404, "Conversation not found.");
  let cursor: { id: string; createdAt: Date } | null = null;
  if (before) { cursor = await prisma.message.findFirst({ where: { id: before, conversationId: id }, select: { id: true, createdAt: true } }); if (!cursor) throw new AppError(422, "Invalid message cursor."); }
  const messages = await prisma.message.findMany({ where: { conversationId: id, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, select: { id: true, direction: true, type: true, textContent: true, mediaId: true, mimeType: true, templateName: true, status: true, errorMessage: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 });
  const hasMore = messages.length > 50; const page = messages.slice(0, 50).reverse();
  let lastInbound = conversation.customer.lastCustomerMessageAt;
  if (providerMode() === "cloud") {
    // A mock conversation or a message received for an old phone connection cannot authorize a live free-form send.
    const verified = await prisma.message.findFirst({ where: { customerId: conversation.customerId, direction: "INBOUND", status: "RECEIVED", whatsappMessageId: { not: null }, NOT: { whatsappMessageId: { startsWith: "mock" } }, AND: [{ rawPayload: { path: ["_crm", "source"], equals: "cloud" } }, { rawPayload: { path: ["_crm", "signatureVerified"], equals: true } }, { rawPayload: { path: ["_crm", "businessAccountId"], equals: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "" } }, { rawPayload: { path: ["_crm", "phoneNumberId"], equals: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "" } }, { rawPayload: { path: ["from"], equals: conversation.customer.phoneNormalized.replace(/^\+/, "") } }] }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    lastInbound = verified?.createdAt ?? null;
  }
  return { ...conversation, messages: page, hasMore, nextCursor: hasMore ? page[0]?.id : null, serviceWindowOpen: serviceWindowOpen(lastInbound), serviceWindowExpiresAt: lastInbound ? new Date(lastInbound.getTime() + 86400000) : null };
}
export async function startConversation(actor: Actor, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, ...customerScope(actor), archivedAt: null } });
  if (!customer) throw new AppError(404, "Customer not found.");
  return prisma.conversation.upsert({ where: { customerId }, create: { customerId, assignedUserId: customer.assignedUserId }, update: {} });
}
const patchSchema = z.object({ status: z.enum(["OPEN", "CLOSED"]).optional(), assignedUserId: z.string().nullable().optional(), read: z.boolean().optional() }).strict();
export async function updateConversation(actor: Actor, id: string, input: unknown) {
  const data = patchSchema.parse(input); await getConversation(actor, id);
  if (data.assignedUserId !== undefined) { assertRole(actor, "ADMIN", "MANAGER"); if (data.assignedUserId && !await prisma.user.findFirst({ where: { id: data.assignedUserId, active: true } })) throw new AppError(422, "Choose an active team member."); }
  return prisma.conversation.update({ where: { id }, data: { status: data.status, assignedUserId: data.assignedUserId, ...(data.read ? { unreadCount: 0 } : {}) } });
}
const sendSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("TEXT"), text: z.string().trim().min(1).max(4096) }), z.object({ type: z.literal("TEMPLATE"), templateId: z.string().min(1), parameters: z.array(z.string().trim().min(1).max(500)).max(20).default([]) })]);
export async function sendMessage(actor: Actor, id: string, input: unknown) {
  const data = sendSchema.parse(input); const conversation = await getConversation(actor, id); const customer = conversation.customer;
  if (customer.archivedAt || ["ARCHIVED", "DO_NOT_CONTACT"].includes(customer.status) || customer.whatsappOptOutAt && !customer.whatsappOptIn) throw new AppError(422, "This customer is not eligible for outbound WhatsApp messages.");
  let template: Awaited<ReturnType<typeof prisma.template.findUnique>> = null; let text: string;
  if (data.type === "TEXT") {
    if (!conversation.serviceWindowOpen || !conversation.serviceWindowExpiresAt || conversation.serviceWindowExpiresAt <= new Date()) throw new AppError(422, "The 24-hour customer service window has closed. Send an approved template.");
    text = data.text;
  } else {
    if (!customer.whatsappOptIn) throw new AppError(422, "Record the customer's WhatsApp opt-in before sending templates.");
    template = await prisma.template.findUnique({ where: { id: data.templateId } });
    if (!template) throw new AppError(404, "Template not found.");
    assertUsableTemplate(template);
    if (templateVariables(template.body).length !== data.parameters.length) throw new AppError(422, "Provide a value for every template variable.");
    text = renderTemplate(template.body, data.parameters);
  }
  // Reserve an auditable message before the external side effect; never retry an ambiguous send automatically.
  const message = await prisma.message.create({ data: { customerId: customer.id, conversationId: id, direction: "OUTBOUND", type: data.type, textContent: text, templateName: template?.name, status: "QUEUED" } });
  try {
    const provider = getWhatsAppProvider();
    const result = data.type === "TEXT" ? await provider.sendTextMessage({ to: customer.phoneNormalized, text }) : await provider.sendTemplateMessage({ to: customer.phoneNormalized, name: template!.name, language: template!.language, parameters: data.parameters, body: text });
    const now = new Date();
    await prisma.$transaction([
      prisma.message.update({ where: { id: message.id }, data: { whatsappMessageId: result.whatsappMessageId, status: "SENT", sentAt: now } }),
      prisma.conversation.update({ where: { id }, data: { lastMessageAt: now, status: "OPEN" } }),
      prisma.customer.update({ where: { id: customer.id }, data: { lastBusinessMessageAt: now, lastContactedAt: now } }),
      prisma.activityLog.create({ data: { customerId: customer.id, userId: actor.id, type: "WHATSAPP_OUTBOUND", entityType: "Message", entityId: message.id, description: data.type === "TEXT" ? "Sent a WhatsApp reply." : `Sent WhatsApp template ${template!.name}.` } }),
    ]);
    await replayPendingWebhooks().catch(() => 0);
    return { id: message.id };
  } catch (error) {
    const ambiguous = !(error instanceof WhatsAppProviderError) || error.ambiguous;
    await prisma.message.update({ where: { id: message.id }, data: { status: "FAILED", failedAt: new Date(), errorCode: error instanceof WhatsAppProviderError ? error.code : "SEND_STATE_UNKNOWN", errorMessage: ambiguous ? "Send outcome is unknown. Review provider delivery before sending again." : error instanceof WhatsAppProviderError ? error.message : "Message could not be sent." } });
    throw new AppError(502, ambiguous ? "Send outcome is unknown. Check delivery before sending again." : error instanceof WhatsAppProviderError ? error.message : "Message could not be sent.");
  }
}
