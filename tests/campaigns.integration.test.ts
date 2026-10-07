import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/auth/policy";
import { saveCampaign, previewCampaign, testCampaign, launchCampaign, previewAudience, controlCampaign, classifyRecipient } from "@/modules/campaigns/service";
import { claimRecipients, processRecipient, recoverExpiredClaims, CLAIM_LEASE_MS, promoteScheduledCampaigns } from "@/modules/campaigns/queue";
import * as providers from "@/modules/whatsapp/provider";
const prefix = `campaign-test-${randomUUID()}`;
const customerIds: string[] = []; const campaignIds: string[] = [];
let admin: Actor; let sales: Actor; let templateId: string; let nextPhone = randomInt(2000000, 7000000); let seq = 0;
const send = vi.fn(async () => ({ whatsappMessageId: `${prefix}-${randomUUID()}` }));
const provider: providers.WhatsAppProvider = { sendTemplateMessage: send, sendTextMessage: send, getTemplates: async () => [], testConnection: async () => ({ connected: true, mode: "mock" }) };
async function customer(extra: Record<string, unknown> = {}) {
  const phone = `+1206${nextPhone++}`; const token = `${prefix}:${seq++}:`;
  const row = await prisma.customer.create({ data: { customerCode: token, businessName: token, contactPerson: "Campaign customer", phone, phoneNormalized: phone, whatsappOptIn: true, whatsappOptInAt: new Date(), ...extra } }); customerIds.push(row.id); return row;
}
async function draft(search: string) {
  const result = await saveCampaign({ name: `${prefix} draft`, templateId, filterDefinition: { search }, variableMapping: { "1": { source: "contactPerson" } } }, admin); campaignIds.push(result.id); return result;
}
async function reviewed(search: string) { const c = await draft(search); const preview = await previewCampaign(c.id, admin); await testCampaign(c.id, { phone: "+12025550199" }, admin); return { campaign: c, count: preview.summary.eligible }; }
async function launch(search: string) { const { campaign, count } = await reviewed(search); return launchCampaign(campaign.id, { confirmation: `SEND ${campaign.name}`, expectedEligible: count }, admin); }
beforeAll(async () => {
  vi.stubEnv("WHATSAPP_MODE", "mock"); vi.stubEnv("WHATSAPP_SEND_RATE_LIMIT", "80");
  vi.spyOn(providers, "getWhatsAppProvider").mockReturnValue(provider);
  admin = await prisma.user.create({ data: { name: prefix, email: `${prefix}@example.test`, role: "ADMIN" } });
  sales = await prisma.user.create({ data: { name: prefix, email: `${prefix}-sales@example.test`, role: "SALESMAN" } });
  templateId = (await prisma.template.create({ data: { name: prefix, language: "en", category: "MARKETING", status: "APPROVED", metaTemplateId: `mock-${prefix}`, body: "Hello {{1}}", lastSyncedAt: new Date() } })).id;
});
afterAll(async () => {
  await prisma.campaignRecipient.deleteMany({ where: { campaignId: { in: campaignIds } } });
  await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
  await prisma.message.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.conversation.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.activityLog.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: admin?.id } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  if (templateId) await prisma.template.delete({ where: { id: templateId } });
  await prisma.user.deleteMany({ where: { id: { in: [admin?.id, sales?.id].filter(Boolean) } } });
  vi.restoreAllMocks(); vi.unstubAllEnvs(); await prisma.$disconnect();
});
describe("campaign snapshots and durable queue", () => {
  it("rejects sending roles at service boundary", async () => {
    await expect(saveCampaign({}, sales)).rejects.toMatchObject({ status: 403 });
    await expect(launchCampaign("missing", {}, sales)).rejects.toMatchObject({ status: 403 });
  });
  it("accounts for all exclusion reasons and requires ACTIVE recipients", async () => {
    const group = `${prefix}-eligibility`;
    await customer({ businessName: group }); await customer({ businessName: group, whatsappOptIn: false }); await customer({ businessName: group, whatsappOptOutAt: new Date() }); await customer({ businessName: group, status: "INACTIVE" }); await customer({ businessName: group, status: "PROSPECT" }); await customer({ businessName: group, archivedAt: new Date(), status: "ARCHIVED" }); await customer({ businessName: group, phoneNormalized: `${prefix}-invalid` });
    const result = await previewAudience({ filterDefinition: { search: group, includeArchived: true } }, admin);
    expect(result.summary).toMatchObject({ matched: 7, eligible: 1, excluded: 6, noConsent: 1, optedOut: 1, inactive: 2, archived: 1, invalidPhone: 1 });
  });
  it("requires preview, test and exact explicit confirmation", async () => {
    const row = await customer(); const c = await draft(row.businessName);
    await expect(launchCampaign(c.id, { confirmation: `SEND ${c.name}`, expectedEligible: 1 }, admin)).rejects.toMatchObject({ status: 422 });
    await previewCampaign(c.id, admin); await testCampaign(c.id, { phone: "+12025550199" }, admin);
    await expect(launchCampaign(c.id, { confirmation: "yes", expectedEligible: 1 }, admin)).rejects.toMatchObject({ status: 422 });
  });
  it("invalidates review and test when synced template content changes", async () => {
    const row = await customer(); const { campaign: c } = await reviewed(row.businessName);
    await prisma.template.update({ where: { id: templateId }, data: { footer: "New footer" } });
    await expect(launchCampaign(c.id, { confirmation: `SEND ${c.name}`, expectedEligible: 1 }, admin)).rejects.toMatchObject({ status: 409 });
    await expect(testCampaign(c.id, { phone: "+12025550199" }, admin)).rejects.toMatchObject({ status: 409 });
    await previewCampaign(c.id, admin);
    await expect(launchCampaign(c.id, { confirmation: `SEND ${c.name}`, expectedEligible: 1 }, admin)).rejects.toMatchObject({ status: 422 });
    await prisma.template.update({ where: { id: templateId }, data: { footer: null } });
  });
  it("snapshots 1,000 recipients exactly once on double submit and claims without overlap", async () => {
    const group = `${prefix}-stress`; const ids = Array.from({ length: 1000 }, (_, i) => `${prefix}-stress-${i}`); customerIds.push(...ids);
    await prisma.customer.createMany({ data: ids.map(id => { const phone = `+1206${nextPhone++}`; return { id, customerCode: id, businessName: group, contactPerson: "Queue test", phone, phoneNormalized: phone, whatsappOptIn: true }; }) });
    const { campaign: c, count } = await reviewed(group); expect(count).toBe(1000);
    await Promise.all([launchCampaign(c.id, { confirmation: `SEND ${c.name}`, expectedEligible: count }, admin), launchCampaign(c.id, { confirmation: `SEND ${c.name}`, expectedEligible: count }, admin)]);
    expect(await prisma.campaignRecipient.count({ where: { campaignId: c.id } })).toBe(1000);
    const claims = (await Promise.all(Array.from({ length: 10 }, () => claimRecipients(100, c.id)))).flat();
    expect(claims.length).toBe(1000); expect(new Set(claims.map(r => r.id)).size).toBe(1000);
    await controlCampaign(c.id, "cancel", admin); expect(await prisma.campaignRecipient.count({ where: { campaignId: c.id, status: "CANCELLED" } })).toBe(1000);
  }, 60000);
  it("honors pause, resume, cancellation and opt-out changes before provider calls", async () => {
    const row = await customer(); const c = await launch(row.businessName); let [claim] = await claimRecipients(1, c.id);
    await controlCampaign(c.id, "pause", admin); const before = send.mock.calls.length; await processRecipient(claim, provider); expect(send.mock.calls.length).toBe(before);
    expect(await claimRecipients(1, c.id)).toHaveLength(0); await controlCampaign(c.id, "resume", admin); [claim] = await claimRecipients(1, c.id);
    await prisma.customer.update({ where: { id: row.id }, data: { whatsappOptIn: false, whatsappOptOutAt: new Date() } }); await processRecipient(claim, provider);
    expect((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe("SKIPPED"); expect(send.mock.calls.length).toBe(before);
  });
  it("skips queued customers made inactive and never sends a mock campaign in cloud mode", async () => {
    const row = await customer(); const c = await launch(row.businessName); const [claim] = await claimRecipients(1, c.id); const before = send.mock.calls.length;
    await prisma.customer.update({ where: { id: row.id }, data: { status: "INACTIVE" } }); await processRecipient(claim, provider); expect(send.mock.calls.length).toBe(before);
    const row2 = await customer(); const c2 = await launch(row2.businessName); const [claim2] = await claimRecipients(1, c2.id); const before2 = send.mock.calls.length;
    vi.stubEnv("WHATSAPP_MODE", "cloud"); await processRecipient(claim2, provider); vi.stubEnv("WHATSAPP_MODE", "mock"); expect(send.mock.calls.length).toBe(before2); expect((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: claim2.id } })).status).toBe("SKIPPED");
  });
  it("does not send when template content changes after queue confirmation", async () => {
    const row = await customer(); const c = await launch(row.businessName); const [claim] = await claimRecipients(1, c.id); const before = send.mock.calls.length;
    await prisma.template.update({ where: { id: templateId }, data: { footer: "Changed after confirmation" } }); await processRecipient(claim, provider); expect(send.mock.calls.length).toBe(before);
    await prisma.template.update({ where: { id: templateId }, data: { footer: null } });
  });
  it("persists the provider attempt before sending, suppresses repeated claims and records outcomes", async () => {
    const row = await customer(); const c = await launch(row.businessName); const [claim] = await claimRecipients(1, c.id); const local = { ...provider, sendTemplateMessage: vi.fn(async () => { const stored = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: claim.id } }); expect(stored.providerAttemptedAt).not.toBeNull(); return { whatsappMessageId: `${prefix}-send-once` }; }) };
    await Promise.all([processRecipient(claim, local), processRecipient(claim, local)]); expect(local.sendTemplateMessage).toHaveBeenCalledTimes(1);
    const stored = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } }); expect(stored.sentCount).toBe(1); expect(stored.status).toBe("COMPLETED");
    await classifyRecipient(c.id, claim.id, { responseClassification: "ORDER_CONFIRMED", orderReference: "SALE-1", orderValue: 1200, currency: "INR" }, admin);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).orderCount).toBe(1);
  });
  it("retries only explicit transient rejections and keeps ambiguous sends for manual review", async () => {
    const row = await customer(); const c = await launch(row.businessName); let [claim] = await claimRecipients(1, c.id);
    const temporary = { ...provider, sendTemplateMessage: vi.fn(async () => { throw new providers.WhatsAppProviderError("Rate limit", true, "429", false); }) };
    await processRecipient(claim, temporary); const retry = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: claim.id } }); expect(retry.status).toBe("QUEUED"); expect(retry.providerAttemptedAt).toBeNull(); expect(retry.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    await prisma.campaignRecipient.update({ where: { id: claim.id }, data: { nextAttemptAt: new Date(0) } }); [claim] = await claimRecipients(1, c.id);
    const unknown = { ...provider, sendTemplateMessage: vi.fn(async () => { throw new providers.WhatsAppProviderError("Timeout", false, "TRANSPORT", true); }) };
    await processRecipient(claim, unknown); const uncertain = await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: claim.id } }); expect(uncertain.status).toBe("FAILED"); expect(uncertain.providerAttemptedAt).not.toBeNull(); expect(uncertain.failureReason).toMatch(/outcome unknown/); expect(await claimRecipients(1, c.id)).toHaveLength(0);
  });
  it("recovers abandoned jobs only when no provider attempt occurred", async () => {
    const group = `${prefix}-recovery`; await customer({ businessName: group }); await customer({ businessName: group }); const c = await launch(group); const claims = await claimRecipients(2, c.id); const old = new Date(Date.now() - CLAIM_LEASE_MS - 1000);
    await prisma.campaignRecipient.update({ where: { id: claims[0].id }, data: { claimedAt: old } }); await prisma.campaignRecipient.update({ where: { id: claims[1].id }, data: { claimedAt: old, providerAttemptedAt: old } }); await recoverExpiredClaims();
    expect((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: claims[0].id } })).status).toBe("QUEUED"); expect((await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: claims[1].id } })).status).toBe("FAILED"); await controlCampaign(c.id, "cancel", admin);
  });
  it("holds scheduled campaigns until their due time", async () => {
    const row = await customer(); const { campaign: c } = await reviewed(row.businessName);
    await launchCampaign(c.id, { confirmation: `SEND ${c.name}`, expectedEligible: 1, scheduledAt: new Date(Date.now() + 3600000).toISOString() }, admin);
    expect(await claimRecipients(1, c.id)).toHaveLength(0); await prisma.campaign.update({ where: { id: c.id }, data: { scheduledAt: new Date(0) } }); await promoteScheduledCampaigns(); expect(await claimRecipients(1, c.id)).toHaveLength(1); await controlCampaign(c.id, "cancel", admin);
  });
});
