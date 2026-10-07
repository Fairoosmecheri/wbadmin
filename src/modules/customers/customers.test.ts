import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePhone } from "./phone";
import { buildCustomerWhere, parseCustomerFilter } from "./filters";
import { bulkCustomerSchema, customerInputSchema } from "./validation";
import type { Actor } from "@/modules/auth/policy";

const actor: Actor = { id: "sales-1", name: "Sales", email: "sales@example.test", role: "SALESMAN", active: true };
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("customer phone normalization", () => {
  it("matches international, formatted and national input to one E.164 number", () => {
    expect(normalizePhone("98765 43210", "IN")).toBe("+919876543210");
    expect(normalizePhone("+91 (98765) 43210", "IN")).toBe("+919876543210");
    expect(normalizePhone("0091 9876543210", "GB")).toBe("+919876543210");
  });
  it("honors explicit country and configured default without hardcoding a national numbering plan", () => {
    vi.stubEnv("DEFAULT_PHONE_COUNTRY", "GB");
    expect(normalizePhone("020 7946 0018")).toBe("+442079460018");
    expect(normalizePhone("202-555-0123", "US")).toBe("+12025550123");
  });
  it.each(["1234", "hello 9876543210", "+919876543210 ext 23", "", "0000000000"])("rejects invalid or ambiguous phone %s", phone => {
    expect(() => normalizePhone(phone, "IN")).toThrow();
  });
  it("rejects invalid country configuration", () => expect(() => normalizePhone("9876543210", "ZZ")).toThrow(/country/));
});

describe("customer filters", () => {
  it("keeps role scope while combining criteria, including a conflicting assignment filter", () => {
    const where = buildCustomerWhere({ search: "Bakery", assignedUserId: "someone-else", areaId: "a-1", tagIds: "t-1,t-2", whatsappOptIn: "false" }, actor);
    expect(where.AND).toEqual(expect.arrayContaining([{ assignedUserId: actor.id }, { assignedUserId: "someone-else" }, { areaId: "a-1" }, { whatsappOptIn: false }, { tags: { some: { tagId: "t-1" } } }, { tags: { some: { tagId: "t-2" } } }]));
    expect(where.AND).toEqual(expect.arrayContaining([{ archivedAt: null, status: { not: "ARCHIVED" } }]));
  });
  it("includes the entire end date and never-contacted customers in inactivity filters", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    const where = buildCustomerWhere({ createdAfter: "2026-10-01", createdBefore: "2026-10-07", notContactedDays: "7" }, actor);
    expect(where.AND).toEqual(expect.arrayContaining([{ createdAt: { gte: new Date("2026-10-01T00:00:00Z"), lte: new Date("2026-10-07T23:59:59.999Z") } }, { OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: new Date("2026-09-30T12:00:00Z") } }] }]));
  });
  it("supports explicit archived and unassigned filters", () => {
    const where = buildCustomerWhere({ status: "ARCHIVED", assignedUserId: "unassigned" }, { ...actor, role: "ADMIN" });
    expect(where.AND).toContainEqual({ status: "ARCHIVED" });
    expect(where.AND).toContainEqual({ assignedUserId: null });
    expect(where.AND).not.toContainEqual({ archivedAt: null, status: { not: "ARCHIVED" } });
  });
  it("keeps selected audience IDs inside the actor's access scope", () => {
    const where = buildCustomerWhere({ customerIds: "mine,foreign,mine" }, actor);
    expect(where.AND).toContainEqual({ assignedUserId: actor.id });
    expect(where.AND).toContainEqual({ id: { in: ["mine", "foreign"] } });
    expect(() => parseCustomerFilter({ customerIds: [] })).toThrow();
  });
  it.each([{ createdBefore: "2026-02-31" }, { createdBefore: "1" }, { createdAfter: "2026-10-07", createdBefore: "2026-10-06" }, { notContactedDays: "-1" }, { whatsappOptIn: "yes" }])("rejects malformed filters %j", input => expect(() => parseCustomerFilter(input)).toThrow());
});

describe("customer input safety", () => {
  const customer = { businessName: "Example bakery", phone: "+919876543210" };
  it("defaults new customers to no consent and requires a source for recorded permission", () => {
    expect(customerInputSchema.parse(customer).whatsappOptIn).toBe(false);
    expect(customerInputSchema.safeParse({ ...customer, whatsappOptIn: true }).success).toBe(false);
    expect(customerInputSchema.safeParse({ ...customer, whatsappOptIn: true, whatsappOptInSource: "IN_PERSON" }).success).toBe(true);
  });
  it.each(["DO_NOT_CONTACT", "ARCHIVED"])("prohibits marketing consent for %s customers", status => {
    expect(customerInputSchema.safeParse({ ...customer, status, whatsappOptIn: true, whatsappOptInSource: "FORM" }).success).toBe(false);
  });
  it("turns empty optional fields into null and rejects impossible order dates", () => {
    expect(customerInputSchema.parse({ ...customer, areaId: "", email: "", lastOrderDate: "" })).toMatchObject({ areaId: null, email: null, lastOrderDate: null });
    expect(customerInputSchema.safeParse({ ...customer, lastOrderDate: "2026-02-31" }).success).toBe(false);
  });
  it("bounds bulk mutations and rejects empty selections", () => {
    expect(bulkCustomerSchema.safeParse({ ids: [], action: "archive" }).success).toBe(false);
    expect(bulkCustomerSchema.safeParse({ ids: Array(501).fill("id"), action: "archive" }).success).toBe(false);
  });
});
