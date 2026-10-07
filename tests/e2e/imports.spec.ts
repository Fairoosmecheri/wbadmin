import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { prisma } from "../../src/lib/db";
const prefix = `Browser-import-${randomUUID().slice(0, 8)}`;
let batchId: string | undefined;
let areaCodes: number[] = [];

test.beforeAll(async () => {
  const candidates = [201, 203, 205, 206, 207, 208, 209, 210, 214, 215, 216, 217, 218, 219, 224, 225, 228, 229, 231, 234];
  const existing = await prisma.customer.findMany({ where: { OR: candidates.map(code => ({ phoneNormalized: { startsWith: `+1${code}55501` } })) }, select: { phoneNormalized: true } });
  areaCodes = candidates.filter(code => !existing.some(customer => customer.phoneNormalized.startsWith(`+1${code}55501`))).slice(0, 10);
  if (areaCodes.length !== 10) throw new Error("Not enough unused fictional phone ranges for browser fixture.");
  if (process.env.WHATSAPP_MODE !== "mock" || process.env.NODE_ENV === "production") throw new Error("Import E2E requires a seeded development database in mock WhatsApp mode.");
});
test.afterAll(async () => {
  const own = await prisma.customer.findMany({ where: { businessName: { startsWith: prefix } }, select: { id: true } });
  const ids = own.map(c => c.id);
  await prisma.activityLog.deleteMany({ where: { OR: [{ customerId: { in: ids } }, ...(batchId ? [{ entityType: "ImportBatch", entityId: batchId }] : [])] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityType: "Customer", entityId: { in: ids } }, ...(batchId ? [{ entityType: "ImportBatch", entityId: batchId }] : [])] } });
  await prisma.customerTag.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  if (batchId) await prisma.importBatch.delete({ where: { id: batchId } });
  await prisma.$disconnect();
});

test("imports 1,000 Excel customers through mapping, validation and confirmation, then exports them", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/login");
  await page.getByLabel("Email address").fill("admin@example.com");
  await page.getByLabel("Password", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD || "ReachDev!2026");
  for (let attempt = 0; attempt < 2; attempt++) {
    const signedIn = page.waitForResponse(response => response.url().includes("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    const response = await signedIn;
    if (response.status() !== 429) { expect(response.ok()).toBe(true); break; }
    const retrySeconds = Number(response.headers()["retry-after"] || 60);
    await new Promise(resolve => setTimeout(resolve, Math.min(60, Math.max(1, retrySeconds)) * 1000 + 100));
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/imports");
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Customers");
  sheet.addRow(["Business Name", "Phone", "WhatsApp Opt-In", "Notes"]);
  for (let index = 0; index < 1000; index++) sheet.addRow([`${prefix} ${String(index).padStart(4, "0")}`, `+1${areaCodes[Math.floor(index / 100)]}55501${String(index % 100).padStart(2, "0")}`, "no", "Fictional reserved phone number for browser validation"]);
  await page.getByLabel(/CSV or XLSX/).setInputFiles({ name: `${prefix}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  const uploaded = page.waitForResponse(response => response.url().endsWith("/api/imports") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload & preview", exact: true }).click();
  const upload = await uploaded; expect(upload.status()).toBe(201); batchId = (await upload.json()).id;
  await expect(page.getByLabel("Business Name *", { exact: true })).toHaveValue("Business Name");
  await expect(page.getByLabel("Phone *", { exact: true })).toHaveValue("Phone");
  const validated = page.waitForResponse(response => response.url().endsWith(`/api/imports/${batchId}/validate`));
  await page.getByRole("button", { name: "Validate all rows", exact: true }).click();
  const validation = await validated; expect(validation.status()).toBe(200);
  const preview = await validation.json();
  expect(preview).toMatchObject({ totalRows: 1000, validRows: 1000, invalidRows: 0, duplicateRows: 0 });
  expect(preview.validated).toHaveLength(50);
  await expect(page.getByText("Page 1 of 20 · 50 rows per page", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /I have reviewed the validation/ }).check();
  const completed = page.waitForResponse(response => response.url().endsWith(`/api/imports/${batchId}/commit`));
  await page.getByRole("button", { name: "Import 1,000 valid rows", exact: true }).click();
  const committed = await completed; expect(committed.status()).toBe(200);
  expect(await committed.json()).toMatchObject({ inserted: 1000, updated: 0, skipped: 0, invalid: 0 });
  await expect(page.getByRole("heading", { name: "Import complete", exact: true })).toBeVisible();
  await expect(page.getByText("1000 added · 0 updated · 0 skipped · 0 invalid", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View customers", exact: true }).click();
  await page.goto(`/customers?search=${prefix}`);
  const customerResponse = await page.request.get(`/api/customers?search=${prefix}&pageSize=100`);
  expect((await customerResponse.json()).total).toBe(1000);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const downloadedPath = await download.path(); expect(downloadedPath).not.toBeNull();
  const exported = parse<Record<string, string>>(await readFile(downloadedPath!), { bom: true, columns: true });
  expect(exported).toHaveLength(1000);
  expect(exported.every((row: Record<string, string>) => row["Business Name"].startsWith(prefix))).toBe(true);
});
