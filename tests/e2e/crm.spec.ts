import { test, expect, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/db";
const adminPassword = process.env.SEED_ADMIN_PASSWORD || "ReachDev!2026";
const base = process.env.APP_URL || "http://localhost:3000";
let createdCustomerId: string | undefined;
let createdUserId: string | undefined;

async function login(page: Page, email = "admin@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword);
  for (let attempt = 0; attempt < 2; attempt++) {
    const responsePromise = page.waitForResponse(r=>r.url().includes("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    const response = await responsePromise;
    if (response.status() !== 429) break;
    await page.waitForTimeout(Math.min(61000, (Number(response.headers()["retry-after"]) || 60) * 1000 + 1000));
  }
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeAll(() => {
  if (process.env.WHATSAPP_MODE !== "mock" || process.env.NODE_ENV === "production") throw new Error("E2E tests require a seeded development database in WHATSAPP_MODE=mock.");
});

test.afterAll(async () => {
  if (createdCustomerId) {
    const id = createdCustomerId;
    await prisma.activityLog.deleteMany({ where: { customerId: id } });
    await prisma.auditLog.deleteMany({ where: { entityId: id } });
    await prisma.followUp.deleteMany({ where: { customerId: id } });
    await prisma.customerNote.deleteMany({ where: { customerId: id } });
    await prisma.customerTag.deleteMany({ where: { customerId: id } });
    await prisma.customer.delete({ where: { id } });
  }
  if (createdUserId) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: createdUserId }, { userId: createdUserId }] } });
    await prisma.user.delete({ where: { id: createdUserId } });
  }
  await prisma.$disconnect();
});

test("admin creates a customer, records a note, and completes a follow-up", async ({ page }) => {
  await login(page);
  await expect(page.getByText("WhatsApp Mock Mode", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Add customer", exact: true }).click();
  await page.getByLabel("Business name").fill("Browser test bakery");
  await page.getByLabel("Contact person").fill("Fictional tester");
  await page.getByLabel("Primary phone").fill("+13035550109");
  await page.getByLabel("Assigned salesperson").selectOption("seed_sales_1");
  const saved = page.waitForResponse(r => r.url().endsWith("/api/customers") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Create customer", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  createdCustomerId = (await response.json()).id;
  await expect(page.getByRole("heading", { name: "Browser test bakery", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByLabel("Note", { exact: true }).fill("Prefers a morning follow-up. Fictional test note.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByText("Note added to the customer timeline.")).toBeVisible();
  await page.getByRole("button", { name: "Follow-ups", exact: true }).click();
  await page.getByRole("button", { name: "Add follow-up", exact: true }).click();
  await page.getByLabel("Follow-up title").fill("Browser test follow-up");
  await page.getByRole("button", { name: "Save follow-up", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Browser test follow-up", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page.getByLabel("Contact outcome").selectOption("INTERESTED");
  await page.getByRole("button", { name: "Save outcome & complete" }).click();
  await page.getByLabel("Follow-up status").selectOption("COMPLETED");
  await expect(page.getByText("Outcome: Interested")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByText("Prefers a morning follow-up. Fictional test note.")).toBeVisible();
});

test("salesperson can only see assigned customers and cannot manage users or settings", async ({ page }) => {
  await login(page, "sales1@example.com");
  const customers = await page.request.get("/api/customers?pageSize=100");
  expect(customers.status()).toBe(200);
  const data = await customers.json();
  expect(data.customers.length).toBeGreaterThan(0);
  expect(data.customers.every((c: { assignedUserId: string }) => c.assignedUserId === "seed_sales_1")).toBe(true);
  expect((await page.request.get("/api/customers/seed_customer_002")).status()).toBe(404);
  expect((await page.request.get("/api/users")).status()).toBe(403);
  expect((await page.request.post("/api/customers", { headers: { Origin: base }, data: {} })).status()).toBe(403);
  expect((await page.request.patch("/api/settings", { headers: { Origin: base }, data: {} })).status()).toBe(403);
  expect((await page.request.get("/api/campaigns")).status()).toBe(403);
  expect((await page.request.get("/api/segments")).status()).toBe(403);
  await page.goto("/segments?mode=views");
  await expect(page.getByRole("tab", { name: /My views/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Team segments/ })).toHaveCount(0);
  expect((await page.request.patch("/api/settings", { headers: { Origin: "https://foreign.invalid" }, data: {} })).status()).toBe(403);
});

test("private pages and APIs require authentication", async ({ page }) => {
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/customers")).status()).toBe(401);
  expect((await page.request.get("/api/users")).status()).toBe(401);
});

test("administrator creates and deactivates a team member", async ({ page }) => {
  await login(page);
  await page.goto("/users");
  await page.getByRole("button", { name: "Add team member", exact: true }).click();
  await page.getByLabel("Full name").fill("Browser test manager");
  await page.getByLabel("Email address").fill(`browser-manager-${Date.now()}@example.com`);
  await page.getByLabel("Role", { exact: true }).selectOption("MANAGER");
  await page.getByLabel("Temporary password").fill("BrowserTestOnly!2026");
  const responsePromise = page.waitForResponse(r=>r.url().endsWith("/api/users")&&r.request().method()==="POST");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  createdUserId = (await response.json()).user.id;
  await expect(page.getByText("User created. Share their temporary password securely.")).toBeVisible();
  await page.getByRole("button", { name: "Edit Browser test manager" }).click();
  await page.getByLabel("Active account").uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Browser test manager" }).getByText("Inactive", { exact: true })).toBeVisible();
  expect((await prisma.user.findUniqueOrThrow({where:{id:createdUserId}})).active).toBe(false);
});

test("mobile navigation and customer search stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByRole("table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});
