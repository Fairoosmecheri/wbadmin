import { createHmac, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/auth/policy";
import { processWebhookPayload, processMockEvents, replayPendingWebhooks } from "@/modules/whatsapp/webhooks";
import { getWhatsAppProvider } from "@/modules/whatsapp/provider";
import { getConversation, sendMessage } from "@/modules/conversations/service";
import { assertUsableTemplate } from "@/modules/templates/service";
import { linkUnmatchedContact } from "@/modules/whatsapp/settings";
import { POST as receiveWebhook } from "@/app/api/webhooks/whatsapp/route";
const prefix = `wa-test-${randomUUID()}`;
let admin: Actor; let sales: Actor; let customerId: string; let conversationId: string; let campaignId: string; let recipientId: string; let templateId: string;
const phone = `+1202555${randomInt(1000, 9999)}`; const unknownPhone = `+1415555${randomInt(1000, 9999)}`;
const ids: string[] = []; const linkedCustomers: string[] = [];
const wrap = (value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value }] }] });
const status = (id: string, state: string) => wrap({ statuses: [{ id, status: state, timestamp: String(Math.floor(Date.now() / 1000)) }] });
const inbound = (id: string, text: string, from = phone, context?: string) => wrap({ messages: [{ id, from: from.replace("+", ""), type: "text", text: { body: text }, timestamp: String(Math.floor(Date.now() / 1000)), ...(context ? { context: { id: context } } : {}) }] });
beforeAll(async () => {
  vi.stubEnv("WHATSAPP_MODE", "mock");
  admin = await prisma.user.create({ data: { name: prefix, email: `${prefix}@example.test`, role: "ADMIN" } });
  sales = await prisma.user.create({ data: { name: `${prefix}-sales`, email: `${prefix}-sales@example.test`, role: "SALESMAN" } });
  const customer = await prisma.customer.create({ data: { customerCode: prefix, businessName: prefix, contactPerson: "Test customer", phone, phoneNormalized: phone, whatsappOptIn: true } }); customerId = customer.id;
  conversationId = (await prisma.conversation.create({ data: { customerId } })).id;
  templateId = (await prisma.template.create({ data: { name: prefix, language: "en", category: "MARKETING", status: "APPROVED", metaTemplateId: `mock-${prefix}`, body: "Hello {{1}}", lastSyncedAt: new Date() } })).id;
  campaignId = (await prisma.campaign.create({ data: { name: prefix, templateId, createdByUserId: admin.id, status: "SENDING", totalRecipients: 1 } })).id;
  const id = `${prefix}-out`; ids.push(id);
  recipientId = (await prisma.campaignRecipient.create({ data: { campaignId, customerId, phone, renderedPayload: {}, status: "SENT", sentAt: new Date(), whatsappMessageId: id } })).id;
  await prisma.message.create({ data: { conversationId, customerId, direction: "OUTBOUND", whatsappMessageId: id, status: "SENT", sentAt: new Date() } });
});
afterAll(async () => {
  await prisma.mockEvent.deleteMany({ where: { OR: [{ payload: { path: ["entry", "0", "changes", "0", "value", "statuses", "0", "recipient_id"], equals: phone.slice(1) } }, { payload: { path: ["entry", "0", "changes", "0", "value", "messages", "0", "from"], equals: phone.slice(1) } }] } });
  const events = await prisma.webhookEvent.findMany({ where: { OR: [{ payload: { path: ["value", "from"], equals: phone.slice(1) } }, { payload: { path: ["value", "from"], equals: unknownPhone.slice(1) } }, ...ids.map(id => ({ payload: { path: ["value", "id"], equals: id } }))] }, select: { id: true } });
  await prisma.webhookEvent.deleteMany({ where: { id: { in: events.map(event => event.id) } } });
  await prisma.unmatchedContact.deleteMany({ where: { phoneNormalized: unknownPhone } });
  await prisma.message.deleteMany({ where: { customerId: { in: linkedCustomers } } }); await prisma.conversation.deleteMany({ where: { customerId: { in: linkedCustomers } } }); await prisma.activityLog.deleteMany({ where: { customerId: { in: linkedCustomers } } }); await prisma.customer.deleteMany({ where: { id: { in: linkedCustomers } } }); await prisma.auditLog.deleteMany({ where: { userId: admin.id } });
  await prisma.campaignRecipient.deleteMany({ where: { campaignId } }); await prisma.campaign.delete({ where: { id: campaignId } });
  await prisma.message.deleteMany({ where: { customerId } }); await prisma.conversation.delete({ where: { id: conversationId } });
  await prisma.activityLog.deleteMany({ where: { customerId } }); await prisma.customer.delete({ where: { id: customerId } }); await prisma.template.delete({ where: { id: templateId } }); await prisma.user.deleteMany({ where: { id: { in: [admin.id, sales.id] } } });
  vi.unstubAllEnvs(); await prisma.$disconnect();
});
describe("WhatsApp persisted integration", () => {
  it("rejects correctly signed webhooks for another business phone before persistence", async () => {
    vi.stubEnv("META_APP_SECRET", "test-secret"); vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "12345"); vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", "67890");
    const payload = { object: "whatsapp_business_account", entry: [{ id: "67890", changes: [{ value: { metadata: { phone_number_id: "wrong-number" }, messages: [{ id: `${prefix}-wrong-phone`, from: phone.slice(1), type: "text", text: { body: "Must not open service window" } }] } }] }] };
    const raw = JSON.stringify(payload); const signature = `sha256=${createHmac("sha256", "test-secret").update(raw).digest("hex")}`;
    const response = await receiveWebhook(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": signature }, body: raw }));
    expect(response.status).toBe(403); expect(await prisma.message.count({ where: { whatsappMessageId: `${prefix}-wrong-phone` } })).toBe(0);
  });
  it("rejects seeded mock templates and stale approvals when live mode is selected", () => {
    vi.stubEnv("WHATSAPP_MODE", "cloud");
    expect(() => assertUsableTemplate({ status: "APPROVED", metaTemplateId: "mock_seed_template_product", headerType: null, components: null, body: "Hello", lastSyncedAt: new Date() })).toThrow(/Sync/);
    expect(() => assertUsableTemplate({ status: "APPROVED", metaTemplateId: "123456789", headerType: null, components: null, body: "Hello", lastSyncedAt: new Date(Date.now() - 48 * 3600000) })).toThrow(/stale/);
    vi.stubEnv("WHATSAPP_MODE", "mock");
  });

  it("atomically applies duplicate and out-of-order status receipts without regressing counters", async () => {
    const id = ids[0]; await Promise.all([processWebhookPayload(status(id, "read")), processWebhookPayload(status(id, "read")), processWebhookPayload(status(id, "delivered")), processWebhookPayload(status(id, "failed"))]);
    expect((await prisma.message.findUniqueOrThrow({ where: { whatsappMessageId: id } })).status).toBe("READ");
    expect((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipientId } })).status).toBe("READ");
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }); expect(campaign.readCount).toBe(1); expect(campaign.deliveredCount).toBe(1); expect(campaign.failedCount).toBe(0);
  });
  it("retains an orphan status and replays it after outbound persistence", async () => {
    const id = `${prefix}-orphan`; ids.push(id); expect((await processWebhookPayload(status(id, "delivered"))).deferred).toBe(1);
    await prisma.message.create({ data: { conversationId, customerId, direction: "OUTBOUND", status: "SENT", whatsappMessageId: id } });
    await replayPendingWebhooks(); expect((await prisma.message.findUniqueOrThrow({ where: { whatsappMessageId: id } })).status).toBe("DELIVERED");
  });
  it("acknowledges campaign test-send receipts after audit persistence without a customer message", async () => {
    const id = `${prefix}-test-send`; ids.push(id);
    expect((await processWebhookPayload(status(id, "sent"))).deferred).toBe(1);
    await prisma.auditLog.create({ data: { userId: admin.id, action: "campaign.test_sent", entityType: "Campaign", entityId: campaignId, metadata: { whatsappMessageId: id, providerMode: "mock" } } });
    await replayPendingWebhooks();
    expect(await prisma.webhookEvent.count({ where: { processed: false, payload: { path: ["value", "id"], equals: id } } })).toBe(0);
  });
  it("deduplicates inbound messages, opens the service window, and attributes a contextual reply", async () => {
    const id = `${prefix}-in`; ids.push(id); const event = inbound(id, "Please send details", phone, ids[0]); await processWebhookPayload(event); await processWebhookPayload(event);
    expect(await prisma.message.count({ where: { whatsappMessageId: id } })).toBe(1);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).unreadCount).toBe(1);
    expect((await getConversation(admin, conversationId)).serviceWindowOpen).toBe(true);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).repliedCount).toBe(1);
  });
  it("does not permit a simulated inbound to open a live customer service window", async () => {
    vi.stubEnv("WHATSAPP_MODE", "cloud");
    try {
      expect((await getConversation(admin, conversationId)).serviceWindowOpen).toBe(false);
      await expect(sendMessage(admin, conversationId, { type: "TEXT", text: "Must not send live from mock history" })).rejects.toMatchObject({ status: 422 });
    } finally { vi.stubEnv("WHATSAPP_MODE", "mock"); }
  });
  it("binds a live service window to signed inbound on the current account and customer phone", async () => {
    const id = `wamid.${prefix}-verified`; ids.push(id);
    const payload = { object: "whatsapp_business_account", entry: [{ id: "67890", changes: [{ value: { metadata: { phone_number_id: "12345" }, messages: [{ id, from: phone.slice(1), type: "text", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: "Verified live inbound" } }] } }] }] };
    const raw = JSON.stringify(payload); const signature = `sha256=${createHmac("sha256", "test-secret").update(raw).digest("hex")}`;
    expect((await receiveWebhook(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": signature }, body: raw }))).status).toBe(200);
    vi.stubEnv("WHATSAPP_MODE", "cloud");
    try {
      expect((await getConversation(admin, conversationId)).serviceWindowOpen).toBe(true);
      vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "54321");
      expect((await getConversation(admin, conversationId)).serviceWindowOpen).toBe(false);
    } finally { vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "12345"); vi.stubEnv("WHATSAPP_MODE", "mock"); }
  });
  it("keeps unknown inbound contacts for review without creating customers", async () => {
    await processWebhookPayload(inbound(`${prefix}-unknown`, "Hello", unknownPhone));
    expect(await prisma.customer.findUnique({ where: { phoneNormalized: unknownPhone } })).toBeNull();
    expect(await prisma.unmatchedContact.findUnique({ where: { phoneNormalized: unknownPhone } })).not.toBeNull();
  });
  it("links reviewed unmatched contacts in cloud mode by replaying original verified provenance", async () => {
    const id = `wamid.${prefix}-unknown-verified`; ids.push(id);
    const payload = { object: "whatsapp_business_account", entry: [{ id: "67890", changes: [{ value: { metadata: { phone_number_id: "12345" }, messages: [{ id, from: unknownPhone.slice(1), type: "text", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: "A new verified customer" } }] } }] }] };
    const raw = JSON.stringify(payload); const signature = `sha256=${createHmac("sha256", "test-secret").update(raw).digest("hex")}`;
    expect((await receiveWebhook(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": signature }, body: raw }))).status).toBe(200);
    const customer = await prisma.customer.create({ data: { customerCode: `${prefix}-linked`, businessName: "Reviewed contact", phone: unknownPhone, phoneNormalized: unknownPhone } }); linkedCustomers.push(customer.id);
    const unmatched = await prisma.unmatchedContact.findUniqueOrThrow({ where: { phoneNormalized: unknownPhone } });
    vi.stubEnv("WHATSAPP_MODE", "cloud");
    try {
      expect(await linkUnmatchedContact(admin, unmatched.id)).toEqual({ linked: true });
      const conversation = await prisma.conversation.findUniqueOrThrow({ where: { customerId: customer.id } });
      expect((await getConversation(admin, conversation.id)).serviceWindowOpen).toBe(true);
      expect(await prisma.message.count({ where: { customerId: customer.id } })).toBe(2);
    } finally { vi.stubEnv("WHATSAPP_MODE", "mock"); }
  });
  it("enforces salesperson scope and server-side service-window expiry", async () => {
    await expect(getConversation(sales, conversationId)).rejects.toMatchObject({ status: 404 });
    await prisma.customer.update({ where: { id: customerId }, data: { lastCustomerMessageAt: new Date(Date.now() - 25 * 3600000) } });
    await expect(sendMessage(admin, conversationId, { type: "TEXT", text: "Outside window" })).rejects.toMatchObject({ status: 422 });
    expect(() => assertUsableTemplate({ status: "PENDING", metaTemplateId: "mock-pending", headerType: null, components: null, body: "Hello" })).toThrow(/approved/);
  });
  it("sends an approved mock template and receives durable sent, delivered, read, and inbound events", async () => {
    const sent = await sendMessage(admin, conversationId, { type: "TEMPLATE", templateId, parameters: ["Customer"] });
    const message = await prisma.message.findUniqueOrThrow({ where: { id: sent.id } }); const id = message.whatsappMessageId!; ids.push(id);
    await prisma.mockEvent.updateMany({ where: { OR: [{ payload: { path: ["entry", "0", "changes", "0", "value", "statuses", "0", "id"], equals: id } }, { payload: { path: ["entry", "0", "changes", "0", "value", "messages", "0", "context", "id"], equals: id } }] }, data: { dueAt: new Date(0) } });
    await processMockEvents();
    const updated = await prisma.message.findUniqueOrThrow({ where: { id: sent.id } }); expect(updated.status).toBe("READ"); expect(updated.deliveredAt).not.toBeNull(); expect(updated.readAt).not.toBeNull();
    expect(await prisma.message.count({ where: { customerId, direction: "INBOUND", textContent: "Thank you! I would like to know more." } })).toBe(1);
  });
  it("persists durable mock delivery failures through the real webhook pipeline", async () => {
    const result = await getWhatsAppProvider().sendTextMessage({ to: phone, text: "[mock:fail]" }); ids.push(result.whatsappMessageId);
    await prisma.message.create({ data: { conversationId, customerId, direction: "OUTBOUND", status: "SENT", whatsappMessageId: result.whatsappMessageId, sentAt: new Date() } });
    await prisma.mockEvent.updateMany({ where: { payload: { path: ["entry", "0", "changes", "0", "value", "statuses", "0", "id"], equals: result.whatsappMessageId } }, data: { dueAt: new Date(0) } });
    await processMockEvents(); expect((await prisma.message.findUniqueOrThrow({ where: { whatsappMessageId: result.whatsappMessageId } })).status).toBe("FAILED");
  });
  it("records STOP as consent withdrawal and blocks outbound messages", async () => {
    await processWebhookPayload(inbound(`${prefix}-stop`, "STOP"));
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } }); expect(customer.whatsappOptIn).toBe(false); expect(customer.status).toBe("DO_NOT_CONTACT"); expect(customer.whatsappOptOutAt).not.toBeNull();
    await expect(sendMessage(admin, conversationId, { type: "TEXT", text: "Forbidden reply" })).rejects.toMatchObject({ status: 422 });
  });
});
