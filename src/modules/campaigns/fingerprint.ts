import { createHash } from "node:crypto";
import type { Template } from "@prisma/client";
import { providerMode } from "@/modules/whatsapp/provider";
/** Bind reviewed content and mode to the exact draft; Meta syncs invalidate prior approval. */
export function campaignFingerprint(template: Template, mapping: unknown) {
  return createHash("sha256").update(JSON.stringify({ name: template.name, language: template.language, body: template.body, headerType: template.headerType, headerContent: template.headerContent, footer: template.footer, buttons: template.buttons, components: template.components, metaTemplateId: template.metaTemplateId, mapping, mode: providerMode() })).digest("hex");
}
