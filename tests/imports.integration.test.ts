import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/authorization";
import { uploadImport, validateImport, commitImport, getImport, failedImportCsv } from "@/modules/imports/service";
import { inferMapping } from "@/modules/imports/validation";
import { exportCustomers } from "@/modules/imports/export";
const prefix = `ImportIT-${randomUUID().slice(0, 8)}`;
const actor: Actor = { id: `${prefix}-admin`, name: prefix, email: `${prefix}@example.test`, role: "ADMIN", active: true };
const salesman: Actor = { id: `${prefix}-sales`, name: `${prefix} Sales`, email: `${prefix}-sales@example.test`, role: "SALESMAN", active: true };
const phoneBase = randomInt(10000, 90000) * 10000;
const phone = (n: number) => `+919${String(phoneBase + n)}`;
const headers = ["Business Name", "Phone", "WhatsApp Opt-In", "WhatsApp Opt-In Source"];
async function prepare(rows: unknown[][], name = "customers.csv") {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Customers");
  sheet.addRow(headers); rows.forEach(row => sheet.addRow(row));
  const bytes = name.endsWith("xlsx") ? Buffer.from(await workbook.xlsx.writeBuffer()) : Buffer.from([headers, ...rows].map(row => row.join(",")).join("\n"));
  const batch = await uploadImport(name, bytes, actor);
  return validateImport(batch.id, inferMapping(headers), actor);
}
const confirm = (batch: { validationToken: string }, duplicateMode: "skip" | "update" | "review" = "skip", decisions = {}) => ({ validationToken: batch.validationToken, duplicateMode, decisions, confirmed: true });

beforeAll(async () => { await prisma.user.createMany({ data: [actor, salesman] }); });
afterAll(async () => {
  const customers = await prisma.customer.findMany({ where: { businessName: { startsWith: prefix } }, select: { id: true } });
  const ids = customers.map(c => c.id);
  await prisma.activityLog.deleteMany({ where: { OR: [{ userId: actor.id }, { customerId: { in: ids } }] } });
  await prisma.auditLog.deleteMany({ where: { userId: actor.id } });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  await prisma.importBatch.deleteMany({ where: { uploadedBy: actor.id } });
  await prisma.user.deleteMany({ where: { id: { in: [actor.id, salesman.id] } } });
  await prisma.$disconnect();
});

describe("persisted import workflow", () => {
  it("imports 1,000 XLSX rows atomically, detects normalized duplicate, paginates preview, and repeats safely", async () => {
    const batch = await prepare([...Array.from({ length: 1000 }, (_, index) => [`${prefix} Customer ${index}`, phone(index), index === 0 ? "yes" : "", index === 0 ? "Signed customer form" : ""]), [`${prefix} Repeated`, phone(0).slice(3), "", ""], [`${prefix} Invalid`, "not-a-phone", "", ""]], "customers.xlsx");
    expect(batch.totalRows).toBe(1002); expect(batch.duplicateRows).toBe(1); expect(batch.invalidRows).toBe(1);
    expect(batch.validated).toHaveLength(50); expect(batch.pages).toBe(21);
    const result = await commitImport(batch.id, confirm(batch), actor);
    expect(result).toMatchObject({ inserted: 1000, updated: 0, skipped: 1, invalid: 1 });
    expect(await commitImport(batch.id, confirm(batch), actor)).toEqual(result);
    expect(await prisma.customer.count({ where: { businessName: { startsWith: prefix } } })).toBe(1000);
    const first = await prisma.customer.findUniqueOrThrow({ where: { phoneNormalized: phone(0) } });
    expect(first.whatsappOptIn).toBe(true); expect(first.whatsappOptInSource).toBe("Signed customer form");
    expect(await prisma.customer.count({ where: { businessName: { startsWith: prefix }, whatsappOptIn: true } })).toBe(1);
    expect(await failedImportCsv(batch.id, actor)).toContain("not-a-phone");
    await expect(getImport(batch.id, salesman)).rejects.toMatchObject({ status: 403 });
  });
  it("requires an individual choice and preserves consent when omitted from a reviewed update", async () => {
    const batch = await prepare([[`${prefix} Updated`, phone(0), "", ""]]);
    expect(batch.reviewCount).toBe(1);
    await expect(commitImport(batch.id, confirm(batch, "review"), actor)).rejects.toMatchObject({ status: 422 });
    expect((await getImport(batch.id, actor)).status).toBe("VALIDATED");
    const report = await commitImport(batch.id, confirm(batch, "review", { "2": "update" }), actor);
    expect(report.updated).toBe(1);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { phoneNormalized: phone(0) } });
    expect(customer.businessName).toBe(`${prefix} Updated`); expect(customer.whatsappOptIn).toBe(true);
  });
  it("rejects stale customer validation without partially importing new rows", async () => {
    const batch = await prepare([[`${prefix} Stale`, phone(1), "", ""], [`${prefix} Must not insert`, phone(2000), "", ""]]);
    await prisma.customer.update({ where: { phoneNormalized: phone(1) }, data: { contactPerson: "Changed after preview" } });
    await expect(commitImport(batch.id, confirm(batch, "update"), actor)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.customer.count({ where: { phoneNormalized: phone(2000) } })).toBe(0);
    expect((await getImport(batch.id, actor)).status).toBe("VALIDATED");
  });
  it("rejects stale validation tokens after a fresh validation", async () => {
    const batch = await prepare([[`${prefix} Revalidate`, phone(2), "", ""]]);
    await validateImport(batch.id, inferMapping(headers), actor);
    await expect(commitImport(batch.id, confirm(batch), actor)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a newly introduced phone duplicate after preview instead of silently overwriting", async () => {
    const batch = await prepare([[`${prefix} New duplicate`, phone(2002), "", ""]]);
    await prisma.customer.create({ data: { customerCode: `${prefix}-external`, businessName: `${prefix} Added elsewhere`, phone: phone(2002), phoneNormalized: phone(2002) } });
    await expect(commitImport(batch.id, confirm(batch, "update"), actor)).rejects.toMatchObject({ status: 409 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { phoneNormalized: phone(2002) } })).businessName).toBe(`${prefix} Added elsewhere`);
    expect((await getImport(batch.id, actor)).status).toBe("VALIDATED");
  });
  it("allows only one concurrent commit and reports a safe retry", async () => {
    const batch = await prepare([[`${prefix} Concurrent`, phone(2001), "", ""]]);
    const outcomes = await Promise.allSettled([commitImport(batch.id, confirm(batch), actor), commitImport(batch.id, confirm(batch), actor)]);
    expect(outcomes.some(result => result.status === "fulfilled")).toBe(true);
    expect(await prisma.customer.count({ where: { phoneNormalized: phone(2001) } })).toBe(1);
    expect((await commitImport(batch.id, confirm(batch), actor)).inserted).toBe(1);
  });
  it("streams selected/filtered CSV and XLSX exports, protecting formulas and salesman scope", async () => {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { phoneNormalized: phone(0) } });
    await prisma.customer.update({ where: { id: customer.id }, data: { notes: '=HYPERLINK("https://example.test")', assignedUserId: salesman.id } });
    const csv = await (await exportCustomers({ format: "csv", ids: [customer.id], filters: { search: prefix } }, actor)).text();
    expect(csv).toContain("'=HYPERLINK"); expect(csv.split("\n")).toHaveLength(3);
    expect(await prisma.customer.count({ where: { assignedUserId: salesman.id, businessName: { startsWith: prefix } } })).toBe(1);
    const response = await exportCustomers({ format: "xlsx", filters: { search: prefix } }, salesman);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
    expect(workbook.worksheets[0].getSheetValues()).toHaveLength(3);
    expect(workbook.worksheets[0].getCell("AA2").value).toBe('=HYPERLINK("https://example.test")'.replace(/^/, "'"));
  });
});
