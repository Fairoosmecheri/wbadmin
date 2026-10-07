import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/modules/auth/policy";

const db = vi.hoisted(() => ({
  customer: { count: vi.fn(), findMany: vi.fn() },
  segment: { findUnique: vi.fn(), findMany: vi.fn() },
  savedCustomerView: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn() },
  $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: {} }));

import { deleteSavedView, previewSegment, resolveCustomerFilter, saveSavedView, saveSegment, listSegments, getSegment } from "./service";

const salesman: Actor = { id: "sales-1", name: "Sales", email: "sales@example.test", role: "SALESMAN", active: true };
const manager: Actor = { ...salesman, role: "MANAGER" };
beforeEach(() => { vi.clearAllMocks(); db.customer.count.mockResolvedValue(0); db.customer.findMany.mockResolvedValue([]); });

describe("dynamic segment authorization and membership", () => {
  it("counts and previews with the actor's assignment scope even when filters target someone else", async () => {
    await previewSegment({ assignedUserId: "sales-2", whatsappOptIn: true }, salesman);
    const where = db.customer.count.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ assignedUserId: "sales-1" });
    expect(where.AND).toContainEqual({ assignedUserId: "sales-2" });
    expect(db.customer.findMany.mock.calls[0][0].where).toEqual(where);
  });

  it("evaluates membership on each request rather than storing customer IDs", async () => {
    db.customer.count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    expect((await previewSegment({ status: "ACTIVE" }, salesman)).total).toBe(2);
    expect((await previewSegment({ status: "ACTIVE" }, salesman)).total).toBe(3);
    expect(db.customer.count).toHaveBeenCalledTimes(2);
  });

  it("keeps selected-customer limits together with permission scope in previews", async () => {
    await previewSegment({ customerIds: ["customer-1", "customer-2"], status: "ACTIVE" }, salesman);
    const where = db.customer.count.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ id: { in: ["customer-1", "customer-2"] } });
    expect(where.AND).toContainEqual({ assignedUserId: salesman.id });
    expect(db.customer.findMany.mock.calls[0][0].where).toEqual(where);
  });

  it("merges an explicit filter with the current stored segment definition", async () => {
    db.segment.findUnique.mockResolvedValue({ filterDefinition: { areaId: "area-1", status: "ACTIVE" } });
    expect(await resolveCustomerFilter({ segmentId: "segment-1", whatsappOptIn: "true" }, manager)).toEqual({ areaId: "area-1", status: "ACTIVE", whatsappOptIn: true });
    await expect(resolveCustomerFilter({ segmentId: "segment-1", viewId: "view-1" }, salesman)).rejects.toThrow(/either/);
  });

  it("rejects shared segment definitions for salespeople without querying the database", async () => {
    await expect(listSegments(salesman)).rejects.toMatchObject({ status: 403 });
    await expect(getSegment("shared", salesman)).rejects.toMatchObject({ status: 403 });
    await expect(resolveCustomerFilter({ segmentId: "shared" }, salesman)).rejects.toMatchObject({ status: 403 });
    expect(db.segment.findUnique).not.toHaveBeenCalled();
    expect(db.segment.findMany).not.toHaveBeenCalled();
  });

  it("blocks salesman segment mutations before database work", async () => {
    await expect(saveSegment({ name: "Unauthorized", filterDefinition: {} }, salesman)).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("private saved customer views", () => {
  it("does not disclose or resolve another user's view", async () => {
    db.savedCustomerView.findFirst.mockResolvedValue(null);
    await expect(resolveCustomerFilter({ viewId: "foreign-view" }, salesman)).rejects.toMatchObject({ status: 404 });
    expect(db.savedCustomerView.findFirst).toHaveBeenCalledWith({ where: { id: "foreign-view", userId: salesman.id }, select: { filterDefinition: true } });
    expect(db.customer.count).not.toHaveBeenCalled();
  });

  it("checks ownership within update and delete mutations", async () => {
    await saveSavedView({ name: "Mine", filterDefinition: { whatsappOptIn: false } }, salesman, "view-1");
    expect(db.savedCustomerView.update).toHaveBeenCalledWith({ where: { id: "view-1", userId: salesman.id }, data: { name: "Mine", filterDefinition: { whatsappOptIn: false } } });
    await deleteSavedView("view-1", salesman);
    expect(db.savedCustomerView.delete).toHaveBeenCalledWith({ where: { id: "view-1", userId: salesman.id } });
  });

  it("saves the resolved filters when a customer list is opened from a segment", async () => {
    db.segment.findUnique.mockResolvedValue({ filterDefinition: { areaId: "area-1", status: "ACTIVE" } });
    await saveSavedView({ name: "Saved from segment", filterDefinition: { segmentId: "segment-1", whatsappOptIn: "true", page: "2" } }, manager);
    expect(db.savedCustomerView.create).toHaveBeenCalledWith({ data: { userId: salesman.id, name: "Saved from segment", filterDefinition: { areaId: "area-1", status: "ACTIVE", whatsappOptIn: true } } });
  });
});
