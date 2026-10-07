import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { replayPendingWebhooks } from "./webhooks";
import { assertRole, type Actor } from "@/lib/authorization";
import { getWhatsAppProvider, providerMode } from "./provider";
const names = ["META_GRAPH_API_VERSION", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "META_APP_SECRET"] as const;
export async function whatsappStatus(actor: Actor) {
  assertRole(actor, "ADMIN");
  const [lastWebhook, verified, connection, pending, unmatched] = await Promise.all([prisma.setting.findUnique({ where: { key: "whatsapp.lastWebhook" } }), prisma.setting.findUnique({ where: { key: "whatsapp.webhookVerified" } }), prisma.setting.findUnique({ where: { key: "whatsapp.connection" } }), prisma.webhookEvent.count({ where: { processed: false } }), prisma.unmatchedContact.findMany({ where: { resolvedAt: null }, orderBy: { lastMessageAt: "desc" }, take: 50, select: { id: true, phoneNormalized: true, displayName: true, lastMessageAt: true } })]);
  return { mode: providerMode(), apiVersion: process.env.META_GRAPH_API_VERSION || "Not configured", configuration: names.map(name => ({ name, present: Boolean(process.env[name]), display: process.env[name] ? name.includes("SECRET") || name.includes("TOKEN") ? "••••••••" : process.env[name] : "Not configured" })), lastWebhook: lastWebhook?.value ?? null, verifiedAt: verified?.value ?? null, connection: connection?.value ?? null, pendingEvents: pending, unmatched, webhookPath: "/api/webhooks/whatsapp" };
}
export async function testConnection(actor: Actor) {
  assertRole(actor, "ADMIN");
  const result = await getWhatsAppProvider().testConnection(); const value = { ...result, checkedAt: new Date().toISOString() };
  await prisma.setting.upsert({ where: { key: "whatsapp.connection" }, create: { key: "whatsapp.connection", value }, update: { value } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "WHATSAPP_CONNECTION_TESTED", entityType: "WhatsApp", metadata: { mode: result.mode, connected: result.connected } } });
  return value;
}

export async function linkUnmatchedContact(actor: Actor, id: string, customerId?: string) {
  assertRole(actor, "ADMIN", "MANAGER");
  const item = await prisma.unmatchedContact.findUnique({ where: { id } });
  if (!item) throw new AppError(404, "Unmatched contact not found.");
  const customer = await prisma.customer.findUnique({ where: customerId ? { id: customerId } : { phoneNormalized: item.phoneNormalized } });
  if (!customer) throw new AppError(422, "Create or update a customer with this primary phone number before linking the contact.");
  if (item.phoneNormalized !== customer.phoneNormalized) throw new AppError(422, "The customer's primary phone must match this contact. Review and update the customer first.");
  // Replay original verified events, preserving connection provenance and history beyond the preview limit.
  await prisma.webhookEvent.updateMany({ where: { eventType: "inbound", OR: [{ payload: { path: ["value", "from"], equals: item.phoneNormalized.replace(/^\+/, "") } }, { payload: { path: ["value", "from"], equals: item.phoneNormalized } }] }, data: { processed: false, processedAt: null, updatedAt: new Date(0) } });
  await replayPendingWebhooks(500);
  await prisma.unmatchedContact.update({ where: { id: item.id }, data: { resolvedAt: new Date(), resolvedCustomerId: customer.id } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "UNMATCHED_CONTACT_LINKED", entityType: "Customer", entityId: customer.id } });
  return { linked: true };
}
