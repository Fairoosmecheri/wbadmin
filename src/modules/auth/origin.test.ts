import { describe, expect, it, vi, afterEach } from "vitest";
import { validateOrigin } from "@/lib/api";

afterEach(() => vi.unstubAllEnvs());
describe("mutation origin protection", () => {
  it("permits requests from the configured application", () => {
    vi.stubEnv("APP_URL", "https://crm.example.com");
    expect(() => validateOrigin(new Headers({ origin: "https://crm.example.com" }), "PATCH")).not.toThrow();
  });
  it("rejects untrusted origins and absent mutation origins", () => {
    vi.stubEnv("APP_URL", "https://crm.example.com");
    expect(() => validateOrigin(new Headers({ origin: "https://attacker.example" }), "POST")).toThrow(/originate/);
    expect(() => validateOrigin(new Headers(), "DELETE")).toThrow(/Origin/);
    expect(() => validateOrigin(new Headers(), "GET")).not.toThrow();
  });
  it("rejects cross-site requests even with a forged origin", () => {
    vi.stubEnv("APP_URL", "https://crm.example.com");
    expect(() => validateOrigin(new Headers({ origin: "https://crm.example.com", "sec-fetch-site": "cross-site" }), "POST")).toThrow(/Cross-site/);
  });
});
