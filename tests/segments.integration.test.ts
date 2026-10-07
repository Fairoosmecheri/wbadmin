import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/auth/policy";
import { deleteSavedView, getSavedView, listSavedViews, listSegments, previewSegment, resolveCustomerFilter, saveSavedView, saveSegment } from "@/modules/segments/service";

const fixture = `segments-${randomUUID()}`;
const admin: Actor = { id: `${fixture}-admin`, name: "Segment integration admin", email: `${fixture}-admin@example.test`, role: "ADMIN", active: true };
const owner: Actor = { id: `${fixture}-owner`, name: "Segment integration owner", email: `${fixture}-owner@example.test`, role: "SALESMAN", active: true };
const other: Actor = { id: `${fixture}-other`, name: "Segment integration other", email: `${fixture}-other@example.test`, role: "SALESMAN", active: true };
const userIds = [admin.id, owner.id, other.id];
const typeId = `${fixture}-type`;
const firstId = `${fixture}-first`;
const secondId = `${fixture}-second`;

beforeAll(async () => {
  await prisma.user.createMany({ data: [admin, owner, other] });
  await prisma.customerType.create({ data: { id: typeId, name: fixture } });
  await prisma.customer.createMany({ data: [
    { id: firstId, customerCode: firstId, businessName: "Integration first", phone: "fixture-1", phoneNormalized: `${fixture}-phone-1`, customerTypeId: typeId, assignedUserId: owner.id, status: "ACTIVE", whatsappOptIn: true },
    { id: secondId, customerCode: secondId, businessName: "Integration second", phone: "fixture-2", phoneNormalized: `${fixture}-phone-2`, customerTypeId: typeId, assignedUserId: other.id, status: "ACTIVE", whatsappOptIn: false },
  ] });
});

afterAll(async () => {
  await prisma.savedCustomerView.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.segment.deleteMany({ where: { createdBy: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: [firstId, secondId] } } });
  await prisma.customerType.deleteMany({ where: { id: typeId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("PostgreSQL dynamic segments and private views", () => {
  it("re-evaluates saved segment counts when a customer's data changes", async () => {
    const segment = await saveSegment({ name: fixture, filterDefinition: { customerTypeId: typeId, status: "ACTIVE" } }, admin);
    expect((await previewSegment({ segmentId: segment.id }, admin)).total).toBe(2);
    expect((await listSegments(admin)).find(row => row.id === segment.id)?.count).toBe(2);
    await prisma.customer.update({ where: { id: secondId }, data: { status: "INACTIVE" } });
    expect((await previewSegment({ segmentId: segment.id }, admin)).total).toBe(1);
    expect((await listSegments(admin)).find(row => row.id === segment.id)?.count).toBe(1);
    await prisma.customer.update({ where: { id: secondId }, data: { status: "ACTIVE" } });
  });

  it("applies assignment permissions to both membership counts and samples", async () => {
    const preview = await previewSegment({ customerTypeId: typeId }, owner);
    expect(preview.total).toBe(1);
    expect(preview.customers.map(customer => customer.id)).toEqual([firstId]);
    expect((await previewSegment({ customerTypeId: typeId, assignedUserId: other.id }, owner)).total).toBe(0);
    await expect(saveSegment({ name: fixture, filterDefinition: {} }, owner)).rejects.toMatchObject({ status: 403 });
  });

  it("allows an owner to manage a view but rejects another user's reads and mutations", async () => {
    const view = await saveSavedView({ name: "My integration view", filterDefinition: { customerTypeId: typeId } }, owner);
    expect((await getSavedView(view.id, owner)).preview.total).toBe(1);
    expect((await listSavedViews(other)).some(row => row.id === view.id)).toBe(false);
    await expect(getSavedView(view.id, other)).rejects.toMatchObject({ status: 404 });
    await expect(resolveCustomerFilter({ viewId: view.id }, other)).rejects.toMatchObject({ status: 404 });
    await expect(saveSavedView({ name: "Stolen", filterDefinition: {} }, other, view.id)).rejects.toMatchObject({ code: "P2025" });
    await expect(deleteSavedView(view.id, other)).rejects.toMatchObject({ code: "P2025" });
    await saveSavedView({ name: "Updated private view", filterDefinition: { customerTypeId: typeId, whatsappOptIn: true } }, owner, view.id);
    expect((await getSavedView(view.id, owner)).name).toBe("Updated private view");
    await deleteSavedView(view.id, owner);
    await expect(getSavedView(view.id, owner)).rejects.toMatchObject({ status: 404 });
  });
});
