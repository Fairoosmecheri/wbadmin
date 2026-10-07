import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { bulkCustomers, getCustomer, listCustomers, saveCustomer, updateCustomerOutcome } from "@/modules/customers/service";
import { saveCatalog } from "@/modules/catalog/service";
import type { Actor } from "@/modules/auth/policy";

const prefix = `customer-test-${randomUUID().slice(0, 8)}`;
const actors: Actor[] = [];
const customerIds: string[] = [];
const generatedPhones = new Set<string>();
const catalogIds: { kind: "area" | "tag" | "customerType"; id: string }[] = [];
let admin: Actor, manager: Actor, sales: Actor, other: Actor;
function phone() {
  let value: string;
  do { value = `+1202555${randomInt(1000, 9999)}`; } while (generatedPhones.has(value));
  generatedPhones.add(value);
  return value;
}
async function create(extra: Record<string, unknown> = {}) {
  const customer = await saveCustomer({ businessName: `${prefix} Bakery`, phone: phone(), ...extra }, admin);
  customerIds.push(customer.id);
  return customer;
}

beforeAll(async () => {
  for (const role of ["ADMIN", "MANAGER", "SALESMAN", "SALESMAN"] as const) {
    const i = actors.length;
    actors.push(await prisma.user.create({ data: { name: `${prefix} ${i}`, email: `${prefix}-${i}@example.test`, role, active: true }, select: { id: true, name: true, email: true, role: true, active: true } }));
  }
  [admin, manager, sales, other] = actors;
});

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.activityLog.deleteMany({ where: { userId: { in: actors.map(actor => actor.id) } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: actors.map(actor => actor.id) } } });
  await prisma.savedCustomerView.deleteMany({ where: { userId: { in: actors.map(actor => actor.id) } } });
  for (const catalog of catalogIds) {
    if (catalog.kind === "area") await prisma.area.delete({ where: { id: catalog.id } });
    if (catalog.kind === "tag") await prisma.tag.delete({ where: { id: catalog.id } });
    if (catalog.kind === "customerType") await prisma.customerType.delete({ where: { id: catalog.id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: actors.map(actor => actor.id) } } });
  await prisma.$disconnect();
});

describe("Customer Master persisted behavior", () => {
  it("normalizes phone before enforcing uniqueness and keeps an audit event", async () => {
    const customer = await create();
    const formatted = `${customer.phoneNormalized.slice(0, 2)} (${customer.phoneNormalized.slice(2, 5)}) ${customer.phoneNormalized.slice(5, 8)}-${customer.phoneNormalized.slice(8)}`;
    await expect(saveCustomer({ businessName: "Duplicate number", phone: formatted }, admin)).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.customer.count({ where: { phoneNormalized: customer.phoneNormalized } })).toBe(1);
    expect(await prisma.activityLog.findFirst({ where: { customerId: customer.id, type: "CUSTOMER_CREATED" } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { entityId: customer.id, action: "customer.created" } })).not.toBeNull();
  });

  it("limits customer reads and outcome updates to assigned salespeople", async () => {
    const mine = await create({ assignedUserId: sales.id });
    const theirs = await create({ assignedUserId: other.id });
    expect((await getCustomer(mine.id, sales)).id).toBe(mine.id);
    await expect(getCustomer(theirs.id, sales)).rejects.toMatchObject({ status: 404 });
    const results = await listCustomers({ search: prefix }, sales);
    expect(results.customers.map(customer => customer.id)).toContain(mine.id);
    expect(results.customers.map(customer => customer.id)).not.toContain(theirs.id);
    expect((await listCustomers({ customerIds: [mine.id, theirs.id] }, sales)).customers.map(customer => customer.id)).toEqual([mine.id]);
    expect((await listCustomers({ search: prefix, assignedUserId: other.id }, sales)).total).toBe(0);
    await expect(updateCustomerOutcome(theirs.id, { status: "INACTIVE" }, sales)).rejects.toMatchObject({ status: 404 });
    await expect(saveCustomer({ businessName: "Denied", phone: phone() }, sales)).rejects.toMatchObject({ status: 403 });
  });

  it("records explicit consent and removes permission when an assigned salesperson marks do not contact", async () => {
    const customer = await create({ assignedUserId: sales.id, whatsappOptIn: true, whatsappOptInSource: "IN_PERSON" });
    expect(customer.whatsappOptInAt).toBeInstanceOf(Date);
    await updateCustomerOutcome(customer.id, { status: "DO_NOT_CONTACT" }, sales);
    const saved = await getCustomer(customer.id, admin);
    expect(saved.whatsappOptIn).toBe(false);
    expect(saved.whatsappOptOutAt).toBeInstanceOf(Date);
    expect(saved.activities.map(event => event.type)).toContain("OPT_OUT");
    expect(await prisma.auditLog.findFirst({ where: { entityId: customer.id, action: "customer.status.updated", userId: sales.id } })).not.toBeNull();
    await expect(updateCustomerOutcome(customer.id, { status: "ACTIVE", assignedUserId: other.id }, sales)).rejects.toThrow();
  });

  it("applies bulk assignment and idempotent tags atomically, then retains history on archive", async () => {
    const first = await create(), second = await create();
    const tag = await saveCatalog("tags", { name: `${prefix} VIP` }, admin);
    catalogIds.push({ kind: "tag", id: tag.id });
    const ids = [first.id, second.id];
    await bulkCustomers({ ids, action: "assign", value: sales.id }, manager);
    await bulkCustomers({ ids, action: "addTags", tagIds: [tag.id, tag.id] }, manager);
    await bulkCustomers({ ids, action: "addTags", tagIds: [tag.id] }, manager);
    expect(await prisma.customerTag.count({ where: { customerId: { in: ids }, tagId: tag.id } })).toBe(2);
    expect((await getCustomer(first.id, sales)).assignedUserId).toBe(sales.id);
    await expect(bulkCustomers({ ids, action: "archive" }, manager)).rejects.toMatchObject({ status: 403 });
    await bulkCustomers({ ids: [first.id], action: "removeTags", tagIds: [tag.id] }, manager);
    expect((await getCustomer(first.id, admin)).tags).toHaveLength(0);
    await bulkCustomers({ ids, action: "archive" }, admin);
    expect((await getCustomer(first.id, admin)).archivedAt).toBeInstanceOf(Date);
    expect((await listCustomers({ search: prefix }, admin)).customers.map(customer => customer.id)).not.toContain(first.id);
    expect((await listCustomers({ search: prefix, status: "ARCHIVED" }, admin)).customers.map(customer => customer.id)).toContain(first.id);
    expect(await prisma.activityLog.count({ where: { customerId: first.id } })).toBeGreaterThan(1);
  });

  it("rejects a partly invalid bulk selection without changing valid records", async () => {
    const customer = await create({ status: "ACTIVE" });
    await expect(bulkCustomers({ ids: [customer.id, "missing-customer"], action: "status", value: "INACTIVE" }, admin)).rejects.toMatchObject({ status: 422 });
    expect((await getCustomer(customer.id, admin)).status).toBe("ACTIVE");
  });

  it("retains an archived classification on edits but disallows new assignments to it", async () => {
    const area = await saveCatalog("areas", { name: `${prefix} North` }, admin);
    catalogIds.push({ kind: "area", id: area.id });
    const customer = await create({ areaId: area.id });
    await saveCatalog("areas", { name: area.name, active: false }, admin, area.id);
    const edited = await saveCustomer({ businessName: `${prefix} Updated`, phone: customer.phone, areaId: area.id, expectedUpdatedAt: customer.updatedAt.toISOString() }, admin, customer.id);
    expect(edited.areaId).toBe(area.id);
    await expect(saveCustomer({ businessName: "New assignment", phone: phone(), areaId: area.id }, admin)).rejects.toMatchObject({ status: 422 });
    await expect(saveCatalog("areas", { name: "Forbidden" }, manager)).rejects.toMatchObject({ status: 403 });
  });

  it("resolves private saved views and prevents another user from reading their filter", async () => {
    const mine = await create({ assignedUserId: sales.id });
    const view = await prisma.savedCustomerView.create({ data: { name: `${prefix} My view`, userId: sales.id, filterDefinition: { search: prefix, assignedUserId: sales.id } } });
    expect((await listCustomers({ viewId: view.id }, sales)).customers.map(customer => customer.id)).toContain(mine.id);
    await expect(listCustomers({ viewId: view.id }, other)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects stale customer edits so address changes cannot reverse a newer WhatsApp opt-out", async () => {
    const customer = await create({ whatsappOptIn: true, whatsappOptInSource: "IN_PERSON" });
    const optOutAt = new Date(customer.updatedAt.getTime() + 1000);
    await prisma.customer.update({ where: { id: customer.id }, data: { whatsappOptIn: false, status: "DO_NOT_CONTACT", whatsappOptOutAt: optOutAt, whatsappOptOutReason: "STOP received", updatedAt: optOutAt } });
    await expect(saveCustomer({ businessName: customer.businessName, phone: customer.phone, addressLine1: "New address", whatsappOptIn: true, whatsappOptInSource: "IN_PERSON", status: "ACTIVE", expectedUpdatedAt: customer.updatedAt.toISOString() }, admin, customer.id)).rejects.toMatchObject({ status: 409 });
    await expect(saveCustomer({ businessName: customer.businessName, phone: customer.phone, addressLine1: "New address" }, admin, customer.id)).rejects.toMatchObject({ status: 409 });
    const latest = await getCustomer(customer.id, admin);
    expect(latest.whatsappOptIn).toBe(false);
    expect(latest.status).toBe("DO_NOT_CONTACT");
    expect(latest.whatsappOptOutReason).toBe("STOP received");
    expect(latest.whatsappOptOutAt).toEqual(optOutAt);
  });

  it("does not transfer consent or an open reply window when the primary number changes", async () => {
    const customer = await create({ whatsappOptIn: true, whatsappOptInSource: "FORM" });
    const original = await prisma.customer.update({ where: { id: customer.id }, data: { lastCustomerMessageAt: new Date(), lastBusinessMessageAt: new Date(), lastContactedAt: new Date(), lastCampaignAt: new Date() } });
    const changed = await saveCustomer({ businessName: original.businessName, phone: phone(), whatsappOptIn: true, whatsappOptInSource: "FORM", expectedUpdatedAt: original.updatedAt.toISOString() }, admin, original.id);
    expect(changed.whatsappOptIn).toBe(false);
    for (const key of ["whatsappOptInAt", "whatsappOptInSource", "lastCustomerMessageAt", "lastBusinessMessageAt", "lastContactedAt", "lastCampaignAt"] as const) expect(changed[key]).toBeNull();
    expect(await prisma.activityLog.findFirst({ where: { customerId: changed.id, type: "PRIMARY_PHONE_CHANGED" } })).not.toBeNull();
    const consented = await saveCustomer({ businessName: changed.businessName, phone: changed.phone, whatsappOptIn: true, whatsappOptInSource: "Fresh permission for replacement number", expectedUpdatedAt: changed.updatedAt.toISOString() }, admin, changed.id);
    expect(consented.whatsappOptIn).toBe(true);
    expect(consented.whatsappOptInAt).toBeInstanceOf(Date);
    expect(consented.lastCustomerMessageAt).toBeNull();
  });
});
