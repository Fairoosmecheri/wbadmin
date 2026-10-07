import { describe, expect, it } from "vitest";
import type { Actor } from "@/modules/auth/policy";
import { canEditNote, canManageFollowUp, transitionError } from "./policy";
import { createFollowUpSchema, noteSchema, updateFollowUpSchema } from "./validation";
const actor: Actor = { id: "sales-a", name: "Sales A", email: "sales-a@example.test", role: "SALESMAN", active: true };
describe("follow-up permissions", () => {
  it("requires both personal follow-up and customer assignment for salespeople", () => {
    expect(canManageFollowUp(actor, { assignedUserId: actor.id, customer: { assignedUserId: actor.id } })).toBe(true);
    expect(canManageFollowUp(actor, { assignedUserId: "sales-b", customer: { assignedUserId: actor.id } })).toBe(false);
    expect(canManageFollowUp(actor, { assignedUserId: actor.id, customer: { assignedUserId: "sales-b" } })).toBe(false);
    expect(canManageFollowUp({ ...actor, active: false }, { assignedUserId: actor.id, customer: { assignedUserId: actor.id } })).toBe(false);
  });
  it("allows active managers and administrators to manage team follow-ups", () => {
    for (const role of ["MANAGER", "ADMIN"] as const) expect(canManageFollowUp({ ...actor, role }, { assignedUserId: "other", customer: { assignedUserId: null } })).toBe(true);
  });
  it("allows only note authors and active administrators to edit notes", () => {
    expect(canEditNote(actor, actor.id)).toBe(true);
    expect(canEditNote(actor, "other")).toBe(false);
    expect(canEditNote({ ...actor, role: "MANAGER" }, "other")).toBe(false);
    expect(canEditNote({ ...actor, role: "ADMIN" }, "other")).toBe(true);
    expect(canEditNote({ ...actor, role: "ADMIN", active: false }, "other")).toBe(false);
  });
});
describe("follow-up state transitions", () => {
  it("requires an outcome only when completing", () => {
    expect(transitionError("PENDING", "COMPLETED")).toMatch(/outcome/);
    expect(transitionError("PENDING", "COMPLETED", "ORDER_CONFIRMED")).toBeNull();
    expect(transitionError("PENDING", "PENDING", "INTERESTED")).toMatch(/only/);
    expect(transitionError("PENDING", "CANCELLED", "INTERESTED")).toMatch(/only/);
    expect(transitionError("PENDING", "CANCELLED")).toBeNull();
  });
  it("does not reopen or rewrite closed follow-ups", () => {
    for (const current of ["COMPLETED", "CANCELLED"]) for (const next of ["PENDING", "COMPLETED", "CANCELLED"]) expect(transitionError(current, next, "OTHER")).toMatch(/closed/);
    expect(transitionError("PENDING", "UNKNOWN")).toMatch(/Unknown/);
  });
  it("rejects invalid values and protects server-owned fields", () => {
    expect(createFollowUpSchema.safeParse({ customerId: "c1", title: "Call", dueAt: "tomorrow" }).success).toBe(false);
    expect(createFollowUpSchema.safeParse({ customerId: "c1", title: "Call", dueAt: "2026-10-07T12:00:00Z", status: "COMPLETED" }).success).toBe(false);
    expect(updateFollowUpSchema.safeParse({ completedAt: "2026-10-07T12:00:00Z" }).success).toBe(false);
    expect(updateFollowUpSchema.safeParse({ updatedAt: "2026-10-07T12:00:00Z" }).success).toBe(false);
    expect(noteSchema.safeParse({ content: "  " }).success).toBe(false);
  });
  it("preserves unspecified fields on partial updates", () => {
    expect(updateFollowUpSchema.parse({ title: "Renamed" })).toEqual({ title: "Renamed" });
    expect(updateFollowUpSchema.parse({ status: "COMPLETED", outcome: "OTHER" })).toEqual({ status: "COMPLETED", outcome: "OTHER" });
    expect(createFollowUpSchema.parse({ customerId: "c1", title: "Call", dueAt: "2026-10-07T12:00:00Z" })).toMatchObject({ type: "GENERAL", priority: "NORMAL" });
  });
});
