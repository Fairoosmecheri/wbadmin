import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { customerScope, type Actor } from "@/modules/auth/policy";

const optionalText = z.preprocess(v => v === "" || v === null ? undefined : v, z.string().trim().max(200).optional());
const optionalBoolean = z.preprocess(v => v === "true" ? true : v === "false" ? false : v === "" || v === null ? undefined : v, z.boolean().optional());
const optionalDate = z.preprocess(v => v === "" || v === null ? undefined : v, z.string().refine(v => z.iso.date().safeParse(v).success || z.iso.datetime({ offset: true }).safeParse(v).success, "Enter a valid ISO date or timestamp").optional());
export const customerFilterSchema = z.object({
  search: optionalText, customerTypeId: optionalText, areaId: optionalText, routeId: optionalText, assignedUserId: optionalText,
  customerIds: z.preprocess(v => typeof v === "string" ? v.split(",").filter(Boolean) : v, z.array(z.string().min(1).max(100)).min(1).max(500).optional()),
  tagIds: z.preprocess(v => typeof v === "string" ? v.split(",").filter(Boolean) : v, z.array(z.string().min(1).max(100)).max(50).optional()),
  status: z.preprocess(v => v === "" || v === null ? undefined : v, z.enum(["ACTIVE", "INACTIVE", "PROSPECT", "DO_NOT_CONTACT", "ARCHIVED"]).optional()),
  whatsappOptIn: optionalBoolean, neverContacted: optionalBoolean, includeArchived: optionalBoolean,
  lastContactedBefore: optionalDate, lastContactedAfter: optionalDate, lastOrderBefore: optionalDate, lastOrderAfter: optionalDate,
  createdAfter: optionalDate, createdBefore: optionalDate,
  notContactedDays: z.preprocess(v => v === "" || v === null ? undefined : v, z.coerce.number().int().min(1).max(36500).optional()),
}).superRefine((value, ctx) => {
  for (const [lower, upper] of [["lastContactedAfter", "lastContactedBefore"], ["lastOrderAfter", "lastOrderBefore"], ["createdAfter", "createdBefore"]] as const) {
    if (value[lower] && value[upper] && new Date(value[lower]) > new Date(value[upper])) ctx.addIssue({ code: "custom", path: [upper], message: "The end date must be on or after the start date." });
  }
});
export type CustomerFilter = z.infer<typeof customerFilterSchema>;
export function parseCustomerFilter(input: unknown): CustomerFilter { return customerFilterSchema.parse(input); }

export function buildCustomerWhere(input: unknown, actor: Actor): Prisma.CustomerWhereInput {
  const filter = parseCustomerFilter(input);
  const clauses: Prisma.CustomerWhereInput[] = [customerScope(actor)];
  if (filter.customerIds) clauses.push({ id: { in: [...new Set(filter.customerIds)] } });
  if (!filter.includeArchived && filter.status !== "ARCHIVED") clauses.push({ archivedAt: null, status: { not: "ARCHIVED" } });
  if (filter.search) clauses.push({ OR: ["businessName", "contactPerson", "phone", "phoneNormalized", "customerCode", "email"].map(key => ({ [key]: { contains: filter.search, mode: "insensitive" } })) });
  for (const field of ["customerTypeId", "areaId", "routeId", "assignedUserId"] as const) {
    if (filter[field]) clauses.push({ [field]: filter[field] === "unassigned" ? null : filter[field] });
  }
  if (filter.status) clauses.push({ status: filter.status });
  if (filter.whatsappOptIn !== undefined) clauses.push({ whatsappOptIn: filter.whatsappOptIn });
  if (filter.tagIds?.length) for (const tagId of filter.tagIds) clauses.push({ tags: { some: { tagId } } });
  if (filter.neverContacted) clauses.push({ lastContactedAt: null });
  const ranges = [["lastContactedAt", "lastContactedAfter", "lastContactedBefore"], ["lastOrderDate", "lastOrderAfter", "lastOrderBefore"], ["createdAt", "createdAfter", "createdBefore"]] as const;
  for (const [field, after, before] of ranges) {
    const lower = filter[after], upper = filter[before];
    if (lower || upper) {
      const end = upper ? new Date(upper.length === 10 ? `${upper}T23:59:59.999Z` : upper) : undefined;
      clauses.push({ [field]: { ...(lower && { gte: new Date(lower) }), ...(end && { lte: end }) } });
    }
  }
  if (filter.notContactedDays) clauses.push({ OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: new Date(Date.now() - filter.notContactedDays * 86400000) } }] });
  return { AND: clauses };
}

export const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(10).max(100).default(25),
  sort: z.enum(["businessName", "customerCode", "createdAt", "lastContactedAt", "status"]).default("businessName"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
