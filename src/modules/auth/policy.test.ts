import { describe, expect, it } from "vitest";
import { canManageUser, customerScope, hasRole, type Actor } from "./policy";
import { createUserSchema, generalSettingsSchema } from "./validation";

const admin: Actor = { id: "admin", name: "Admin", email: "admin@example.com", role: "ADMIN", active: true };
const salesman: Actor = { ...admin, id: "sales", role: "SALESMAN" };

describe("authorization", () => {
  it("limits salespeople to their assigned customers", () => {
    expect(customerScope(salesman)).toEqual({ assignedUserId: "sales" });
    expect(customerScope(admin)).toEqual({});
    expect(customerScope({ ...admin, role: "MANAGER" })).toEqual({});
  });
  it("rejects inactive accounts even when role matches", () => {
    expect(hasRole({ ...admin, active: false }, ["ADMIN"])).toBe(false);
    expect(hasRole(salesman, ["ADMIN", "MANAGER"])).toBe(false);
  });
  it("prevents self-demotion and self-deactivation", () => {
    expect(canManageUser(admin, admin, { active: false }, 2)).toMatch(/another administrator/);
    expect(canManageUser(admin, admin, { role: "SALESMAN" }, 2)).toMatch(/another administrator/);
    expect(canManageUser(admin, admin, { role: "ADMIN" }, 1)).toBeNull();
  });
  it("protects the final active administrator", () => {
    expect(canManageUser(admin, { ...admin, id: "other" }, { role: "MANAGER" }, 1)).toMatch(/At least one/);
    expect(canManageUser(admin, { ...admin, id: "other" }, { active: false }, 2)).toBeNull();
  });
  it("forbids managers from creating or changing team access", () => {
    expect(canManageUser({ ...admin, role: "MANAGER" }, salesman, { active: false }, 1)).toMatch(/Only administrators/);
  });
});

describe("account and regional validation", () => {
  it("requires secure password length", () => {
    const fields = { name: "Test User", email: "user@example.com", role: "SALESMAN" };
    expect(createUserSchema.safeParse({ ...fields, password: "short" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...fields, password: "a-long-unique-passphrase" }).success).toBe(true);
  });
  it("rejects invalid timezone identifiers", () => {
    const fields = { businessName: "Demo", defaultPhoneCountry: "IN", dateFormat: "DD/MM/YYYY" };
    expect(generalSettingsSchema.safeParse({ ...fields, timezone: "Invalid/Zone" }).success).toBe(false);
    expect(generalSettingsSchema.safeParse({ ...fields, timezone: "Asia/Kolkata" }).success).toBe(true);
  });
});
