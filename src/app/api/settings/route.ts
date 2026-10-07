import { handleApi } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/authorization";
import { prisma } from "@/lib/db";
import { getGeneralSettings } from "@/modules/auth/settings";
import { generalSettingsSchema } from "@/modules/auth/validation";

export async function GET(request: Request) {
  return handleApi(async () => { await requireUser(); return Response.json({ settings: await getGeneralSettings() }); }, request);
}

export async function PATCH(request: Request) {
  return handleApi(async () => {
    const actor = await requireRole("ADMIN");
    const settings = generalSettingsSchema.parse(await request.json());
    await prisma.$transaction([
      prisma.setting.upsert({ where: { key: "general" }, create: { key: "general", value: settings }, update: { value: settings } }),
      prisma.auditLog.create({ data: { userId: actor.id, action: "GENERAL_SETTINGS_UPDATED", entityType: "Setting", entityId: "general", metadata: { fields: Object.keys(settings) } } }),
    ]);
    return Response.json({ settings });
  }, request);
}
