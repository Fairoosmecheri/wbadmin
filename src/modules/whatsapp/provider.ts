import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
export type TemplateSend = { to: string; name: string; language: string; parameters?: string[]; body?: string };
export type ProviderTemplate = { id: string; name: string; language: string; category: string; status: string; components: Array<Record<string, unknown>> };
export type ConnectionInfo = { connected: boolean; displayPhoneNumber?: string; verifiedName?: string; mode: "mock" | "cloud" };
export interface WhatsAppProvider {
  sendTemplateMessage(input: TemplateSend): Promise<{ whatsappMessageId: string }>;
  sendTextMessage(input: { to: string; text: string }): Promise<{ whatsappMessageId: string }>;
  getTemplates(): Promise<ProviderTemplate[]>;
  testConnection(): Promise<ConnectionInfo>;
}
export class WhatsAppProviderError extends Error {
  constructor(message: string, public retryable = false, public code?: string, public ambiguous = false) { super(message); this.name = "WhatsAppProviderError"; }
}
export function providerMode(): "mock" | "cloud" {
  const mode = process.env.WHATSAPP_MODE || "mock";
  if (mode !== "mock" && mode !== "cloud") throw new WhatsAppProviderError("WHATSAPP_MODE must be mock or cloud.");
  return mode;
}
export function cloudConfiguration() {
  const version = process.env.META_GRAPH_API_VERSION;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const businessId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!version || !/^v\d+\.\d+$/.test(version) || !token || !phoneId || !businessId || !/^\d+$/.test(phoneId) || !/^\d+$/.test(businessId)) throw new WhatsAppProviderError("Configure the Meta API version, access token, phone number ID, and business account ID in the server environment.");
  return { version, token, phoneId, businessId };
}
class CloudProvider implements WhatsAppProvider {
  private async request(path: string, body?: unknown) {
    const config = cloudConfiguration();
    let response: Response;
    try { response = await fetch(`https://graph.facebook.com/${config.version}/${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), cache: "no-store" }); }
    catch { throw new WhatsAppProviderError("Meta could not be reached. Check connection health before retrying.", false, "TRANSPORT", Boolean(body)); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = String(result.error?.code ?? response.status);
      // Avoid reflecting full provider payloads, which can contain private data.
      throw new WhatsAppProviderError(`Meta rejected this operation (code ${code}).`, response.status === 429 || response.status >= 500 || result.error?.is_transient === true, code, Boolean(body) && response.status >= 500);
    }
    return result;
  }
  async sendTemplateMessage({ to, name, language, parameters = [] }: TemplateSend) {
    const result = await this.request(`${cloudConfiguration().phoneId}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "template", template: { name, language: { code: language }, ...(parameters.length ? { components: [{ type: "body", parameters: parameters.map(text => ({ type: "text", text })) }] } : {}) } });
    if (!result.messages?.[0]?.id) throw new WhatsAppProviderError("Meta accepted the request without a message identifier; manual review is required.", false, "MISSING_ID", true);
    return { whatsappMessageId: String(result.messages[0].id) };
  }
  async sendTextMessage({ to, text }: { to: string; text: string }) {
    const result = await this.request(`${cloudConfiguration().phoneId}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "text", text: { preview_url: false, body: text } });
    if (!result.messages?.[0]?.id) throw new WhatsAppProviderError("Meta accepted the request without a message identifier; manual review is required.", false, "MISSING_ID", true);
    return { whatsappMessageId: String(result.messages[0].id) };
  }
  async getTemplates(): Promise<ProviderTemplate[]> {
    const templates: ProviderTemplate[] = []; let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const result = await this.request(`${cloudConfiguration().businessId}/message_templates?fields=id,name,language,category,status,components&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
      if (!Array.isArray(result.data)) throw new WhatsAppProviderError("Meta returned an invalid template response.");
      templates.push(...result.data);
      if (!result.paging?.next) return templates;
      const next = result.paging?.cursors?.after;
      if (!next || next === after) throw new WhatsAppProviderError("Meta template pagination could not be completed; existing templates were preserved.");
      after = next;
    }
    throw new WhatsAppProviderError("Template sync exceeded the supported page limit; existing templates were preserved.");
  }
  async testConnection(): Promise<ConnectionInfo> {
    const result = await this.request(`${cloudConfiguration().phoneId}?fields=id,display_phone_number,verified_name`);
    return { connected: Boolean(result.id), displayPhoneNumber: result.display_phone_number, verifiedName: result.verified_name, mode: "cloud" };
  }
}
export const MOCK_TEMPLATES: ProviderTemplate[] = [
  { id: "mock-welcome", name: "welcome_followup", language: "en", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Hello {{1}}, thank you for connecting with us. How can we help your business today?" }, { type: "FOOTER", text: "Reply STOP to opt out" }] },
  { id: "mock-offer", name: "weekly_offer", language: "en", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: "Hi {{1}}, our latest offers are ready for {{2}}. Reply to speak with your account manager." }, { type: "FOOTER", text: "Reply STOP to opt out" }] },
  { id: "mock-pending", name: "new_product_update", language: "en", category: "MARKETING", status: "PENDING", components: [{ type: "BODY", text: "Discover our newest range, {{1}}." }] },
];
export async function enqueueMockInbound(to: string, text: string, contextId?: string, delay = 0) {
  const id = `mock.in.${randomUUID()}`;
  const payload = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { contacts: [{ wa_id: to.replace(/^\+/, ""), profile: { name: "Mock contact" } }], messages: [{ id, from: to.replace(/^\+/, ""), timestamp: String(Math.floor((Date.now() + delay) / 1000)), type: "text", text: { body: text }, ...(contextId ? { context: { id: contextId } } : {}) }] } }] }] };
  await prisma.mockEvent.create({ data: { eventType: "inbound", payload, dueAt: new Date(Date.now() + delay) } });
  return id;
}
class MockProvider implements WhatsAppProvider {
  private async send(to: string, body: string) {
    const id = `mock.out.${randomUUID()}`;
    const fail = body.includes("[mock:fail]");
    const statuses = fail ? ["sent", "failed"] : ["sent", "delivered", "read"];
    await prisma.mockEvent.createMany({ data: statuses.map((status, index) => ({ eventType: "status", dueAt: new Date(Date.now() + 1000 + index * 1500), payload: { object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id, status, recipient_id: to.replace(/^\+/, ""), timestamp: String(Math.floor((Date.now() + 1000 + index * 1500) / 1000)), ...(status === "failed" ? { errors: [{ code: 131026, title: "Simulated delivery failure" }] } : {}) }] } }] }] } as Prisma.InputJsonValue })) });
    if (!fail) await enqueueMockInbound(to, "Thank you! I would like to know more.", id, 6500);
    return { whatsappMessageId: id };
  }
  sendTemplateMessage(input: TemplateSend) { return this.send(input.to, input.body ?? input.parameters?.join(" ") ?? input.name); }
  sendTextMessage(input: { to: string; text: string }) { return this.send(input.to, input.text); }
  async getTemplates() { return MOCK_TEMPLATES; }
  async testConnection(): Promise<ConnectionInfo> { return { connected: true, mode: "mock", displayPhoneNumber: "Simulated number", verifiedName: "Local demonstration" }; }
}
export function getWhatsAppProvider(): WhatsAppProvider { return providerMode() === "cloud" ? new CloudProvider() : new MockProvider(); }
