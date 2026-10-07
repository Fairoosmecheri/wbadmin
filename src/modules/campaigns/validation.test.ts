import { describe, expect, it } from "vitest";
import { exclusionReason, renderCampaignPayload, templateProblem, transitionAllowed } from "./validation";
const customer = { phoneNormalized: "+12025550101", whatsappOptIn: true, whatsappOptOutAt: null, archivedAt: null, status: "ACTIVE" };
describe("campaign rules", () => {
  it("requires active status, valid E.164 phone and current consent", () => {
    expect(exclusionReason(customer)).toBeNull();
    expect(exclusionReason({ ...customer, whatsappOptIn: false })).toBe("noConsent");
    expect(exclusionReason({ ...customer, whatsappOptOutAt: new Date() })).toBe("optedOut");
    expect(exclusionReason({ ...customer, status: "DO_NOT_CONTACT" })).toBe("optedOut");
    expect(exclusionReason({ ...customer, status: "INACTIVE" })).toBe("inactive");
    expect(exclusionReason({ ...customer, status: "PROSPECT" })).toBe("inactive");
    expect(exclusionReason({ ...customer, archivedAt: new Date() })).toBe("archived");
    expect(exclusionReason({ ...customer, phoneNormalized: "bad" })).toBe("invalidPhone");
  });
  it("renders fields and literals and rejects missing values", () => {
    const template = { name: "offer", language: "en", body: "Hi {{1}}, visit {{2}}." }; const row = { contactPerson: "Mina", businessName: "Blue Bakery", customerCode: "C001" };
    expect(renderCampaignPayload(template, { "1": { source: "contactPerson" }, "2": { source: "literal", value: "our shop" } }, row).body).toBe("Hi Mina, visit our shop.");
    expect(() => renderCampaignPayload(template, {}, row)).toThrow(/Map variable/);
    expect(() => renderCampaignPayload(template, { "1": { source: "literal", value: "" } }, row)).toThrow(/empty/);
  });
  it("only permits safe campaign control transitions", () => {
    expect(transitionAllowed("SENDING", "pause")).toBe(true); expect(transitionAllowed("PAUSED", "resume")).toBe(true); expect(transitionAllowed("COMPLETED", "resume")).toBe(false); expect(transitionAllowed("CANCELLED", "resume")).toBe(false); expect(transitionAllowed("DRAFT", "pause")).toBe(false);
  });
  it("rejects unapproved, unsynced or unsupported templates", () => {
    const template = { status: "APPROVED", body: "Hello {{1}}", headerType: null, headerContent: null, buttons: null, lastSyncedAt: new Date() };
    expect(templateProblem(template)).toBeNull(); expect(templateProblem({ ...template, status: "PAUSED" })).toMatch(/approved/); expect(templateProblem({ ...template, headerType: "IMAGE" })).toMatch(/Media/); expect(templateProblem({ ...template, body: "Hi {{name}}" })).toMatch(/numbered/);
  });
});
