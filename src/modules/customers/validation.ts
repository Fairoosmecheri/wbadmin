import { z } from "zod";
const nullable = (max = 200) => z.string().trim().max(max).nullable().optional().transform(value => value || null);
export const customerInputSchema = z.object({
  expectedUpdatedAt: z.iso.datetime().optional(),
  customerCode: z.string().trim().max(60).optional(), businessName: z.string().trim().min(2, "Business name needs at least 2 characters").max(200),
  contactPerson: z.string().trim().max(200).default(""), phone: z.string().trim().min(5).max(60), alternatePhone: nullable(60),
  email: z.union([z.email(), z.literal(""), z.null()]).optional().transform(v => v || null),
  customerTypeId: nullable(), areaId: nullable(), routeId: nullable(), assignedUserId: nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "PROSPECT", "DO_NOT_CONTACT", "ARCHIVED"]).default("ACTIVE"),
  whatsappOptIn: z.boolean().default(false), whatsappOptInSource: nullable(300), whatsappOptOutReason: nullable(500),
  addressLine1: nullable(500), addressLine2: nullable(500), city: nullable(), district: nullable(), state: nullable(), postalCode: nullable(30), country: nullable(100),
  notes: nullable(10000), tagIds: z.array(z.string().min(1)).max(100).default([]),
  lastOrderDate: z.union([z.iso.date(), z.literal(""), z.null()]).optional().transform(v => v ? new Date(`${v}T00:00:00Z`) : null),
}).superRefine((value, ctx) => {
  if (value.whatsappOptIn && !value.whatsappOptInSource) ctx.addIssue({ code: "custom", path: ["whatsappOptInSource"], message: "Record how the customer gave permission to receive WhatsApp messages." });
  if (value.whatsappOptIn && ["DO_NOT_CONTACT", "ARCHIVED"].includes(value.status)) ctx.addIssue({ code: "custom", path: ["whatsappOptIn"], message: "Customers who must not be contacted cannot be opted in." });
});
export type CustomerInput = z.input<typeof customerInputSchema>;
export const bulkCustomerSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(["assign", "status", "addTags", "removeTags", "customerType", "area", "route", "archive"]),
  value: z.string().max(200).nullable().optional(), tagIds: z.array(z.string().min(1)).max(100).optional(),
});
