import { z } from "zod";

export const followUpTypes = ["CALL", "WHATSAPP", "VISIT", "GENERAL"] as const;
export const followUpPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const followUpOutcomes = ["INTERESTED", "NOT_INTERESTED", "CALL_LATER", "ORDER_CONFIRMED", "NO_RESPONSE", "OTHER"] as const;
const fields = {
  assignedUserId: z.string().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(10000).nullable().optional(),
  type: z.enum(followUpTypes),
  priority: z.enum(followUpPriorities),
  dueAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
};
export const createFollowUpSchema = z.object({ customerId: z.string().min(1).max(100), ...fields, type: fields.type.default("GENERAL"), priority: fields.priority.default("NORMAL") }).strict();
export const updateFollowUpSchema = z.object({ ...fields, status: z.enum(["PENDING", "COMPLETED", "CANCELLED"]), outcome: z.enum(followUpOutcomes).nullable(), updatedAt: z.iso.datetime({ offset: true }) }).partial().strict().refine((value) => Object.keys(value).some((key) => key !== "updatedAt"), "Provide a change to save.");
export const listFollowUpsSchema = z.object({
  bucket: z.enum(["all", "overdue", "today", "tomorrow", "week", "upcoming", "my"]).default("all"),
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED", "ALL"]).default("PENDING"),
  customerId: z.string().max(100).optional(),
  assignedUserId: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const noteSchema = z.object({ content: z.string().trim().min(1).max(10000) }).strict();
