import { prisma } from "@/lib/db";
import { generalSettingsSchema, type GeneralSettings } from "./validation";

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const record = await prisma.setting.findUnique({ where: { key: "general" } });
  const parsed = generalSettingsSchema.safeParse(record?.value);
  return parsed.success ? parsed.data : {
    businessName: "Reach CRM",
    timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",
    defaultPhoneCountry: process.env.DEFAULT_PHONE_COUNTRY || "IN",
    dateFormat: "DD/MM/YYYY",
  };
}
