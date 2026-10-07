import { describe, expect, it } from "vitest";
import { cleanCustomerFilter, clearSegmentConditions, customerFilterUrl, savedViewInputSchema, segmentInputSchema } from "./validation";

describe("stored dynamic filter validation", () => {
  it("preserves false consent and removes table controls from saved filters", () => {
    expect(cleanCustomerFilter({ whatsappOptIn: "false", search: "  bakery  ", areaId: "", page: "8", sort: "businessName" })).toEqual({ whatsappOptIn: false, search: "bakery" });
  });

  it("deduplicates tags and rejects reversed ranges instead of saving an empty audience", () => {
    expect(cleanCustomerFilter({ tagIds: "one,two,one" })).toEqual({ tagIds: ["one", "two"] });
    expect(() => cleanCustomerFilter({ lastOrderAfter: "2026-10-07", lastOrderBefore: "2026-10-06" })).toThrow(/end date/);
    expect(() => cleanCustomerFilter({ createdAfter: "2026-10-07", createdBefore: "2026-10-07" })).not.toThrow();
  });

  it("round-trips combined consent, relative contact and tag conditions in URLs", () => {
    const filter = { whatsappOptIn: false, notContactedDays: 45, tagIds: ["priority", "wholesale"], search: "A & B" };
    const url = new URL(customerFilterUrl(filter), "https://crm.example");
    expect(cleanCustomerFilter(Object.fromEntries(url.searchParams))).toEqual(filter);
  });

  it("preserves and deduplicates a selected-customer limit through editing and URL state", () => {
    const selected = cleanCustomerFilter({ customerIds: ["customer-1", "customer-2", "customer-1"], status: "ACTIVE" });
    expect(selected.customerIds).toEqual(["customer-1", "customer-2"]);
    expect(cleanCustomerFilter({ ...selected, areaId: "manjeri" }).customerIds).toEqual(selected.customerIds);
    expect(clearSegmentConditions(selected)).toEqual({ customerIds: ["customer-1", "customer-2"] });
    expect(cleanCustomerFilter(Object.fromEntries(new URL(customerFilterUrl(selected), "https://crm.example").searchParams))).toEqual(selected);
    expect(clearSegmentConditions({ status: "ACTIVE" })).toEqual({});
  });

  it("does not permit clients to choose a segment creator or saved-view owner", () => {
    expect(() => segmentInputSchema.parse({ name: "Other user", createdBy: "victim", filterDefinition: {} })).toThrow();
    expect(() => savedViewInputSchema.parse({ name: "Other user", userId: "victim", filterDefinition: {} })).toThrow();
    expect(() => savedViewInputSchema.parse({ name: "   ", filterDefinition: {} })).toThrow();
  });
});
