import { z } from "zod";
import { isSupportedCountry, type CountryCode } from "libphonenumber-js";
import { roles } from "./policy";

export const passwordSchema = z.string().min(12, "Use at least 12 characters.").max(128);
const userFields = {
  name: z.string().trim().min(2).max(100),
  email: z.email().trim().toLowerCase().max(254),
  role: z.enum(roles),
  phone: z.string().trim().max(30).nullish(),
};
export const createUserSchema = z.object({ ...userFields, password: passwordSchema });
export const updateUserSchema = z.object({ ...userFields, active: z.boolean(), password: passwordSchema.optional() }).partial().strict();
export const generalSettingsSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Choose a valid IANA timezone."),
  defaultPhoneCountry: z.string().length(2).toUpperCase().refine(value => isSupportedCountry(value as CountryCode), "Choose a valid phone country code."),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
