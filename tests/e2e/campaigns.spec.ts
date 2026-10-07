import { spawn, type ChildProcess } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/db";
const startedAt = new Date();
const testPhone = `+1202555${randomInt(1000, 9999)}`;
let customerPhone = "";
const prefix = `Browser campaign ${randomUUID().slice(0, 8)}`;
let worker: ChildProcess | undefined;
async function stopWorker() { if (!worker || worker.exitCode !== null) return; const child = worker; await new Promise<void>(resolve => { const timer = setTimeout(() => child.kill("SIGKILL"), 15000); child.once("exit", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM"); }); worker = undefined; }
let customerId: string; let templateId: string; let campaignId: string;
test.beforeAll(async () => {
  if (process.env.WHATSAPP_MODE !== "mock" || process.env.NODE_ENV === "production") throw new Error("Campaign E2E requires mock mode and a development database.");
  const phone = `+1206${randomInt(2000000, 8999999)}`; customerPhone = phone;
  customerId = (await prisma.customer.create({ data: { customerCode: prefix, businessName: prefix, contactPerson: "Fictional campaign contact", phone, phoneNormalized: phone, whatsappOptIn: true, whatsappOptInAt: new Date(), whatsappOptInSource: "MANUAL" } })).id;
  templateId = (await prisma.template.create({ data: { name: prefix.replaceAll(" ", "_").toLowerCase(), metaTemplateId: `mock-${prefix}`, language: "en", category: "MARKETING", status: "APPROVED", lastSyncedAt: new Date(), body: "Hello {{1}}, thank you for being our customer.", footer: "Reply STOP to opt out" } })).id;
});
test.afterAll(async () => {
  await stopWorker();
  const phoneDigits = [customerPhone, testPhone].map(phone => phone.replace("+", ""));
  await prisma.mockEvent.deleteMany({ where: { createdAt: { gte: startedAt }, OR: phoneDigits.flatMap(phone => [{ payload: { path: ["entry", "0", "changes", "0", "value", "statuses", "0", "recipient_id"], equals: phone } }, { payload: { path: ["entry", "0", "changes", "0", "value", "messages", "0", "from"], equals: phone } }]) } });
  await prisma.webhookEvent.deleteMany({ where: { createdAt: { gte: startedAt }, OR: phoneDigits.flatMap(phone => [{ payload: { path: ["value", "recipient_id"], equals: phone } }, { payload: { path: ["value", "from"], equals: phone } }]) } });
  await prisma.unmatchedContact.deleteMany({ where: { phoneNormalized: testPhone, createdAt: { gte: startedAt } } });
  const campaigns = await prisma.campaign.findMany({ where: { name: prefix }, select: { id: true } });
  const ids = campaigns.map(c => c.id);
  await prisma.campaignRecipient.deleteMany({ where: { campaignId: { in: ids } } });
  await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.activityLog.deleteMany({ where: { customerId } }); await prisma.message.deleteMany({ where: { customerId } }); await prisma.conversation.deleteMany({ where: { customerId } });
  if (customerId) await prisma.customer.delete({ where: { id: customerId } }); if (templateId) await prisma.template.delete({ where: { id: templateId } }); await prisma.$disconnect();
});
test("managerial campaign wizard previews, tests, confirms, schedules and controls a mock campaign", async ({ page }) => {
  test.setTimeout(180000); page.setDefaultTimeout(15000);
  await page.goto("/login"); await page.getByLabel("Email address").fill("admin@example.com"); await page.getByLabel("Password", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD || "ReachDev!2026"); for (let attempt = 0; attempt < 2; attempt++) {
    const signedIn = page.waitForResponse(response => response.url().includes("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Sign in to workspace" }).click(); const response = await signedIn;
    if (response.status() !== 429) { expect(response.ok()).toBe(true); break; }
    const retrySeconds = Number(response.headers()["retry-after"] || 60); await new Promise(resolve => setTimeout(resolve, Math.min(60, Math.max(1, retrySeconds)) * 1000 + 100));
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/campaigns/new"); await expect(page.getByRole("heading", { name: "Create a campaign" })).toBeVisible();
  await page.getByLabel("Campaign name").fill(prefix); await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByPlaceholder("Name, code, phone or email").fill(prefix); await page.getByRole("button", { name: "Preview audience" }).click(); await expect(page.getByText("Eligible", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(prefix.replaceAll(" ", "_").toLowerCase().replaceAll("_", " ")) }).click(); await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Variable {{1}}").selectOption("contactPerson"); await page.getByRole("button", { name: "Continue", exact: true }).click(); await expect(page.getByText("Hello Fictional campaign contact, thank you for being our customer.")).toBeVisible(); await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Authorized test number").fill(testPhone); await page.getByRole("button", { name: "Send test message" }).click(); await expect(page.getByText(/Test message simulated successfully/)).toBeVisible(); await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Test sent successfully", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Schedule", exact: true }).click(); const later = new Date(Date.now() + 3600000); const local = new Date(later.getTime() - later.getTimezoneOffset() * 60000).toISOString().slice(0, 16); await page.getByLabel(/Send date and time/).fill(local);
  await page.getByLabel(/I have reviewed the audience/).check(); await page.getByLabel(/Type SEND/).fill(`SEND ${prefix}`); const launched = page.waitForResponse(r => r.url().endsWith("/launch")); await page.getByRole("button", { name: "Confirm schedule" }).click(); const result = await launched; expect(result.status()).toBe(200); campaignId = (await result.json()).id;
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}$`)); await expect(page.getByText("SCHEDULED", { exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "Export results" })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click(); await expect(page.getByText("PAUSED", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Resume", exact: true }).click(); await expect(page.getByText("SCHEDULED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await page.getByRole("button", { name: "Confirm cancellation" }).click(); await expect(page.getByText("CANCELLED", { exact: true }).first()).toBeVisible();
  const base = process.env.APP_URL || "http://localhost:3000";
  const created = await page.request.post("/api/campaigns", { headers: { Origin: base }, data: { name: prefix, templateId, filterDefinition: { search: prefix }, variableMapping: { "1": { source: "contactPerson" } } } }); expect(created.status()).toBe(201); const sendId = (await created.json()).id;
  expect((await page.request.post(`/api/campaigns/${sendId}/preview`, { headers: { Origin: base } })).status()).toBe(200);
  expect((await page.request.post(`/api/campaigns/${sendId}/test`, { headers: { Origin: base }, data: { phone: testPhone } })).status()).toBe(200);
  expect((await page.request.post(`/api/campaigns/${sendId}/launch`, { headers: { Origin: base }, data: { confirmation: `SEND ${prefix}`, expectedEligible: 1 } })).status()).toBe(200);
  worker = spawn(process.execPath, ["--import", "tsx", "--env-file=.env", "src/worker.ts"], { cwd: process.cwd(), env: { ...process.env, WHATSAPP_MODE: "mock", WHATSAPP_SEND_BATCH_SIZE: "1", WHATSAPP_SEND_RATE_LIMIT: "20" }, stdio: "ignore" });
  try {
    await page.goto(`/campaigns/${sendId}`);
    await expect.poll(async () => (await prisma.campaign.findUniqueOrThrow({ where: { id: sendId } })).readCount, { timeout: 30000 }).toBe(1);
    await expect.poll(async () => (await prisma.campaign.findUniqueOrThrow({ where: { id: sendId } })).repliedCount, { timeout: 30000 }).toBe(1);
    await expect(page.getByRole("table").getByText("READ", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Classify response", exact: true }).click(); await page.getByLabel("Classification", { exact: true }).selectOption("ORDER_CONFIRMED"); await page.getByLabel("Order reference · optional").fill("E2E-ORDER-1"); await page.getByLabel("Order value · optional").fill("1500"); await page.getByRole("button", { name: "Save classification" }).click(); await expect(page.getByRole("button", { name: "ORDER CONFIRMED" })).toBeVisible();
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: sendId } })).orderCount).toBe(1);
  } finally { await stopWorker(); }
  const exported = await page.request.get(`/api/campaigns/${campaignId}/export`); expect(exported.status()).toBe(200); expect(await exported.text()).toContain(prefix);
});
