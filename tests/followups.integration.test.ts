import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Actor } from "@/modules/auth/policy";
import { createFollowUp, listFollowUps, updateFollowUp } from "@/modules/followups/service";
import { createNote, listNotes, updateNote } from "@/modules/timeline/notes-service";
import { customerTimeline } from "@/modules/timeline/service";

const prefix = `followups-test-${randomUUID()}`;
const actor = (suffix: string, role: Actor["role"]): Actor => ({ id: `${prefix}-${suffix}`, name: suffix, email: `${prefix}-${suffix}@example.test`, role, active: true });
const admin = actor("admin", "ADMIN"), manager = actor("manager", "MANAGER"), salesperson = actor("sales", "SALESMAN"), otherSalesperson = actor("other-sales", "SALESMAN");
const customerId = `${prefix}-customer`, otherCustomerId = `${prefix}-other-customer`;
const customerIds = [customerId, otherCustomerId], userIds = [admin, manager, salesperson, otherSalesperson].map(user => user.id);
const followup = (title: string) => ({ customerId, title, dueAt: new Date(Date.now() + 3600000).toISOString(), type: "CALL", priority: "HIGH" });
beforeAll(async () => {
  await prisma.user.createMany({ data: [admin, manager, salesperson, otherSalesperson] });
  await prisma.customer.createMany({ data: [{ id: customerId, customerCode: `${prefix}-1`, businessName: "Follow-up test customer", phone: "test-primary", phoneNormalized: `${prefix}-phone-1`, assignedUserId: salesperson.id }, { id: otherCustomerId, customerCode: `${prefix}-2`, businessName: "Other follow-up test customer", phone: "test-secondary", phoneNormalized: `${prefix}-phone-2`, assignedUserId: otherSalesperson.id }] });
});
afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customerNote.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.followUp.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.message.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.conversation.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});
describe("follow-up database authorization and state", () => {
  it("only exposes personally assigned follow-ups for assigned customers", async () => {
    const own = await createFollowUp(salesperson, followup("My next call"));
    const team = await createFollowUp(manager, { ...followup("Manager call"), assignedUserId: manager.id });
    const mine = await listFollowUps(salesperson, { customerId });
    expect(mine.items.map(item => item.id)).toContain(own.id);
    expect(mine.items.map(item => item.id)).not.toContain(team.id);
    await expect(updateFollowUp(salesperson, team.id, { title: "Not allowed" })).rejects.toMatchObject({ status: 404 });
    await expect(createFollowUp(salesperson, { ...followup("Not allowed"), customerId: otherCustomerId })).rejects.toMatchObject({ status: 404 });
    await expect(createFollowUp(salesperson, { ...followup("Not allowed"), assignedUserId: manager.id })).rejects.toMatchObject({ status: 403 });
    await expect(createFollowUp(manager, { ...followup("Invalid salesperson"), assignedUserId: otherSalesperson.id })).rejects.toMatchObject({ status: 422 });
    await expect(listFollowUps(otherSalesperson, { customerId })).rejects.toMatchObject({ status: 404 });
    await expect(listFollowUps({ ...admin, active: false }, {})).rejects.toMatchObject({ status: 403 });
  });
  it("preserves type and priority on update and protects concurrent changes", async () => {
    const created = await createFollowUp(salesperson, followup("Original title"));
    const changed = await updateFollowUp(salesperson, created.id, { title: "Updated title", updatedAt: created.updatedAt.toISOString() });
    expect(changed).toMatchObject({ title: "Updated title", type: "CALL", priority: "HIGH" });
    await expect(updateFollowUp(salesperson, created.id, { title: "Stale update", updatedAt: "2000-01-01T00:00:00Z" })).rejects.toMatchObject({ status: 409 });
  });
  it("completes with an outcome and updates contact and order timestamps atomically", async () => {
    const created = await createFollowUp(salesperson, followup("Confirm order"));
    await expect(updateFollowUp(salesperson, created.id, { status: "COMPLETED" })).rejects.toMatchObject({ status: 409 });
    const completed = await updateFollowUp(salesperson, created.id, { status: "COMPLETED", outcome: "ORDER_CONFIRMED" });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).toBeInstanceOf(Date);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.lastContactedAt).toEqual(completed.completedAt);
    expect(customer.lastOrderDate).toEqual(completed.completedAt);
    await expect(updateFollowUp(admin, created.id, { status: "PENDING" })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.activityLog.count({ where: { entityId: created.id, type: "FOLLOWUP_COMPLETED" } })).toBe(1);
  });
  it("cancels without outcome and retains history", async () => {
    const created = await createFollowUp(salesperson, followup("Cancelled visit"));
    const cancelled = await updateFollowUp(salesperson, created.id, { status: "CANCELLED" });
    expect(cancelled).toMatchObject({ status: "CANCELLED", outcome: null, completedAt: null });
    expect(await prisma.activityLog.count({ where: { entityId: created.id, type: "FOLLOWUP_CANCELLED" } })).toBe(1);
    const closed = await listFollowUps(salesperson, { customerId, status: "CANCELLED" });
    expect(closed.items.map(item => item.id)).toContain(created.id);
  });
  it("revokes follow-up access after customer reassignment", async () => {
    const created = await createFollowUp(salesperson, followup("Reassignment check"));
    try {
      await prisma.customer.update({ where: { id: customerId }, data: { assignedUserId: otherSalesperson.id } });
      await expect(updateFollowUp(salesperson, created.id, { title: "Stale permission" })).rejects.toMatchObject({ status: 404 });
      const result = await listFollowUps(otherSalesperson, { customerId });
      expect(result.items).toHaveLength(0);
    } finally { await prisma.customer.update({ where: { id: customerId }, data: { assignedUserId: salesperson.id } }); }
  });
});
describe("notes and merged timeline", () => {
  it("enforces note author/admin access and records edits", async () => {
    const note = await createNote(salesperson, customerId, { content: "Prefers a morning call." });
    await expect(updateNote(manager, customerId, note.id, { content: "Not my note" })).rejects.toMatchObject({ status: 403 });
    await expect(createNote(otherSalesperson, customerId, { content: "Not assigned" })).rejects.toMatchObject({ status: 404 });
    await expect(updateNote(salesperson, otherCustomerId, note.id, { content: "Wrong customer" })).rejects.toMatchObject({ status: 404 });
    const edited = await updateNote(admin, customerId, note.id, { content: "Prefers a call after 10am.", updatedAt: note.updatedAt.toISOString() });
    expect(edited.content).toBe("Prefers a call after 10am.");
    await expect(updateNote(salesperson, customerId, note.id, { content: "Stale", updatedAt: "2000-01-01T00:00:00Z" })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.activityLog.count({ where: { entityId: note.id, type: "NOTE_UPDATED" } })).toBe(1);
    const managerNotes = await listNotes(manager, customerId, {});
    expect(managerNotes.items.find(item => item.id === note.id)?.canEdit).toBe(false);
  });
  it("merges dated messages, notes and activity with stable pagination and no raw payloads", async () => {
    const conversation = await prisma.conversation.create({ data: { customerId } });
    const stamp = new Date("2026-01-01T12:00:00Z");
    await prisma.message.create({ data: { conversationId: conversation.id, customerId, direction: "OUTBOUND", textContent: "Thank you for your order.", status: "READ", sentAt: stamp, deliveredAt: new Date(stamp.getTime() + 1000), readAt: new Date(stamp.getTime() + 2000), rawPayload: { privateProviderField: "must not appear" } } });
    const full = await customerTimeline(manager, customerId, { limit: 100 });
    const kinds = full.items.map(item => item.kind);
    expect(kinds).toContain("NOTE_ADDED");
    expect(kinds).toContain("NOTE_UPDATED");
    expect(kinds).toContain("FOLLOWUP_COMPLETED");
    expect(kinds).toContain("CUSTOMER_CREATED");
    expect(kinds).toContain("BUSINESS_REPLY");
    expect(kinds).toContain("MESSAGE_DELIVERED");
    expect(kinds).toContain("MESSAGE_READ");
    expect(JSON.stringify(full)).not.toContain("must not appear");
    expect(full.items.every(item => !item.title.includes("_"))).toBe(true);
    expect(full.items.map(item => item.occurredAt.getTime())).toEqual(full.items.map(item => item.occurredAt.getTime()).sort((a, b) => b - a));
    const first = await customerTimeline(manager, customerId, { limit: 3 });
    const second = await customerTimeline(manager, customerId, { limit: 3, page: 2 });
    expect([...first.items, ...second.items].map(item => item.id)).toEqual(full.items.slice(0, 6).map(item => item.id));
    await expect(customerTimeline(otherSalesperson, customerId, {})).rejects.toMatchObject({ status: 404 });
    const own = await customerTimeline(salesperson, customerId, { limit: 100 });
    expect(own.items.some(item => item.description.includes("Manager call"))).toBe(false);
  });
});
