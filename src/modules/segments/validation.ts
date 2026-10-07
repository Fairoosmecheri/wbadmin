import { z } from "zod";
import { parseCustomerFilter, type CustomerFilter } from "@/modules/customers/filters";

export const segmentInputSchema = z.object({
  name: z.string().trim().min(1, "Give this segment a name.").max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  filterDefinition: z.record(z.string(), z.unknown()),
}).strict();

export const savedViewInputSchema = segmentInputSchema.omit({ description: true });

/** Store only supported, explicitly set filters; table controls never become conditions. */
export function cleanCustomerFilter(input: unknown): CustomerFilter {
  const parsed = parseCustomerFilter(input);
  const filter = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined)) as CustomerFilter;
  for (const [after, before] of [["lastContactedAfter", "lastContactedBefore"], ["lastOrderAfter", "lastOrderBefore"], ["createdAfter", "createdBefore"]] as const) {
    if (filter[after] && filter[before] && new Date(filter[after]).getTime() > new Date(filter[before]).getTime()) {
      throw new z.ZodError([{ code: "custom", path: [before], message: "The end date must be on or after the start date." }]);
    }
  }
  if (filter.tagIds) filter.tagIds = [...new Set(filter.tagIds)];
  if (filter.customerIds) filter.customerIds = [...new Set(filter.customerIds)];
  return filter;
}

/** Clearing editable conditions must retain an explicit selected-customer boundary. */
export function clearSegmentConditions(filter: CustomerFilter): CustomerFilter {
  return filter.customerIds ? { customerIds: [...filter.customerIds] } : {};
}

export function customerFilterUrl(filter: unknown) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(cleanCustomerFilter(filter))) {
    query.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return `/customers?${query}`;
}
