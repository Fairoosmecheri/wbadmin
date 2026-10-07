import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceStatus, isOptOut, renderTemplate, serviceWindowOpen, verifyWebhookSignature } from "./policy";
afterEach(() => vi.unstubAllEnvs());
describe("WhatsApp policy boundaries", () => {
  it("enforces the 24-hour service window, including exact expiry and future timestamps", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(serviceWindowOpen(new Date("2026-10-06T12:00:01Z"), now)).toBe(true);
    expect(serviceWindowOpen(new Date("2026-10-06T12:00:00Z"), now)).toBe(false);
    expect(serviceWindowOpen(new Date("2026-10-08T12:00:00Z"), now)).toBe(false);
    expect(serviceWindowOpen(null, now)).toBe(false);
  });
  it("authenticates the exact raw webhook bytes", () => {
    const body = '{"object":"whatsapp_business_account"}'; const secret = "test-app-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(body + " ", signature, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=bad", secret)).toBe(false);
    expect(verifyWebhookSignature(body, signature, undefined)).toBe(false);
  });
  it("does not regress delivery receipts when webhooks arrive out of order", () => {
    expect(advanceStatus("READ", "SENT")).toBe("READ");
    expect(advanceStatus("DELIVERED", "FAILED")).toBe("DELIVERED");
    expect(advanceStatus("SENT", "FAILED")).toBe("FAILED");
    expect(advanceStatus("FAILED", "SENT")).toBe("FAILED");
    expect(advanceStatus("FAILED", "READ")).toBe("READ");
  });
  it("supports additional configured exact keywords while retaining standard opt-outs", () => {
    vi.stubEnv("WHATSAPP_OPT_OUT_KEYWORDS", "BASTA, NO MORE, വേണ്ട");
    expect(isOptOut("basta!")).toBe(true);
    expect(isOptOut("  no more? ")).toBe(true);
    expect(isOptOut("വേണ്ട")).toBe(true);
    expect(isOptOut("STOP")).toBe(true);
    expect(isOptOut("no more offers today please")).toBe(false);
  });
  it("matches clear opt-out commands without false positives in normal prose", () => {
    for (const text of ["STOP", " unsubscribe ", "Stop all!", "opt-out"]) expect(isOptOut(text)).toBe(true);
    expect(isOptOut("Please stop by tomorrow")).toBe(false);
    expect(renderTemplate("Hello {{1}}, welcome to {{2}}", ["Asha", "Acme"])).toBe("Hello Asha, welcome to Acme");
  });
});
