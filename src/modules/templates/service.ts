import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { assertRole, type Actor } from "@/lib/authorization";
import { getWhatsAppProvider, providerMode } from "@/modules/whatsapp/provider";
import { templateVariables } from "@/modules/whatsapp/policy";
export function assertUsableTemplate(template: { status: string; metaTemplateId: string | null; headerType: string | null; components: Prisma.JsonValue; body: string; lastSyncedAt?: Date | null }) {
  if (template.status !== "APPROVED") throw new AppError(422, "Choose an approved WhatsApp template.");
  if (providerMode() === "cloud" && (!template.metaTemplateId || !/^\d+$/.test(template.metaTemplateId))) throw new AppError(422, "Sync an approved template from Meta before sending live messages.");
  if (providerMode() === "cloud" && (!template.lastSyncedAt || Date.now() - template.lastSyncedAt.getTime() > Math.max(1, Math.min(168, Number(process.env.WHATSAPP_TEMPLATE_SYNC_MAX_AGE_HOURS) || 24)) * 3600000)) throw new AppError(422, "Template approval is stale. Sync from Meta before sending live messages.");
  if (template.headerType && !["TEXT", "NONE"].includes(template.headerType)) throw new AppError(422, "This template needs a media header. Choose a text-only template.");
  const components = Array.isArray(template.components) ? template.components as Array<Record<string, unknown>> : [];
  if (components.some(c => c.type === "HEADER" && /\{\{/.test(String(c.text ?? ""))) || components.some(c => c.type === "BUTTONS" && /\{\{|\"type\":\"(?:COPY_CODE|FLOW)\"/.test(JSON.stringify(c)))) throw new AppError(422, "This template needs header or button parameters. Choose a template with body variables only.");
  if (templateVariables(template.body).some((variable, index) => Number(variable) !== index + 1)) throw new AppError(422, "Template body variables must be numbered consecutively starting at 1.");
  if (/\{\{\s*[a-z_]/i.test(template.body)) throw new AppError(422, "Named template parameters are not supported. Choose a template with numbered body variables.");
}
export async function listTemplates(actor: Actor, params: URLSearchParams) {
  const page = Math.max(1, Number(params.get("page")) || 1); const search = params.get("search")?.slice(0, 100);
  const where: Prisma.TemplateWhereInput = { ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { body: { contains: search, mode: "insensitive" } }] } : {}), ...(params.get("language") ? { language: params.get("language")! } : {}), ...(params.get("category") ? { category: params.get("category")! } : {}), ...(actor.role === "SALESMAN" ? { status: "APPROVED" } : params.get("status") ? { status: params.get("status")! } : {}) };
  const [items, total] = await Promise.all([prisma.template.findMany({ where, orderBy: { name: "asc" }, take: 30, skip: (page - 1) * 30 }), prisma.template.count({ where })]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / 30)), source: providerMode() };
}
export async function syncTemplates(actor: Actor) {
  assertRole(actor, "ADMIN", "MANAGER");
  const items = await getWhatsAppProvider().getTemplates(); const now = new Date(); const mode = providerMode();
  await prisma.$transaction(async tx => {
    for (const item of items) {
      const body = item.components.find(c => c.type === "BODY"); const header = item.components.find(c => c.type === "HEADER"); const footer = item.components.find(c => c.type === "FOOTER"); const buttons = item.components.find(c => c.type === "BUTTONS");
      const data = { metaTemplateId: item.id, name: item.name, language: item.language, category: item.category, status: item.status, body: String(body?.text ?? ""), headerType: header ? String(header.format ?? "TEXT") : null, headerContent: header?.text ? String(header.text) : null, footer: footer?.text ? String(footer.text) : null, buttons: buttons ? buttons as Prisma.InputJsonValue : Prisma.JsonNull, components: item.components as Prisma.InputJsonValue, variables: templateVariables(String(body?.text ?? "")), lastSyncedAt: now };
      await tx.template.upsert({ where: { name_language: { name: item.name, language: item.language } }, create: data, update: data });
    }
    await tx.template.updateMany({ where: { ...(mode === "mock" ? { metaTemplateId: { startsWith: "mock-" } } : { NOT: { metaTemplateId: { startsWith: "mock-" } } }), metaTemplateId: { ...(mode === "mock" ? { startsWith: "mock-" } : {}), notIn: items.map(item => item.id) } }, data: { status: "UNAVAILABLE", lastSyncedAt: now } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "TEMPLATES_SYNCED", entityType: "Template", metadata: { source: mode, count: items.length } } });
  });
  return { count: items.length, source: mode };
}
