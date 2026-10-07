import { z } from "zod";
import { normalizePhone } from "@/modules/customers/phone";
import { renderTemplate, templateVariables } from "@/modules/whatsapp/policy";

export const variableMappingSchema = z.record(z.string().regex(/^\d+$/), z.object({ source: z.enum(["contactPerson", "businessName", "customerCode", "literal"]), value: z.string().trim().max(500).optional() }));
export const campaignInputSchema = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(2000).optional(), templateId: z.string().min(1).max(100), segmentId: z.string().max(100).nullable().optional(), filterDefinition: z.record(z.string(), z.unknown()).default({}), variableMapping: variableMappingSchema.default({}) }).strict();
export type VariableMapping = z.infer<typeof variableMappingSchema>;
export type RenderCustomer = { contactPerson: string; businessName: string; customerCode: string };
export type EligibleCustomer = { phoneNormalized: string; whatsappOptIn: boolean; whatsappOptOutAt: Date | null; archivedAt: Date | null; status: string };
export function exclusionReason(customer: EligibleCustomer): "inactive" | "archived" | "optedOut" | "noConsent" | "invalidPhone" | null {
  if (customer.archivedAt || customer.status === "ARCHIVED") return "archived";
  if (customer.status === "DO_NOT_CONTACT" || customer.whatsappOptOutAt) return "optedOut";
  if (customer.status !== "ACTIVE") return "inactive";
  if (!customer.whatsappOptIn) return "noConsent";
  try { if (normalizePhone(customer.phoneNormalized) !== customer.phoneNormalized) return "invalidPhone"; } catch { return "invalidPhone"; }
  return null;
}
export function templateProblem(template: { status: string; body: string; headerType: string | null; headerContent: string | null; buttons: unknown; lastSyncedAt: Date | null }) {
  if (template.status !== "APPROVED" || !template.lastSyncedAt) return "Select a currently approved, synced template.";
  if (template.headerType && !["TEXT", "NONE"].includes(template.headerType)) return "Media-header templates are not supported for campaigns yet.";
  if (template.headerContent?.includes("{{")) return "Header variables are not supported for campaigns yet.";
  if (template.buttons && JSON.stringify(template.buttons).includes("{{")) return "Dynamic button parameters are not supported for campaigns yet.";
  if (/\{\{\s*[^\d\s}]/.test(template.body)) return "Use a template with numbered body variables.";
  if (templateVariables(template.body).some((key, index) => Number(key) !== index + 1)) return "Template body variables must be sequential, starting at 1.";
  return null;
}
export function renderCampaignPayload(template: { name: string; language: string; body: string }, mapping: VariableMapping, customer: RenderCustomer) {
  const parameters = templateVariables(template.body).map(key => {
    const entry = mapping[key];
    if (!entry) throw new Error(`Map variable {{${key}}} before continuing.`);
    const value = entry.source === "literal" ? entry.value?.trim() : customer[entry.source]?.trim();
    if (!value) throw new Error(`Variable {{${key}}} is empty for ${customer.businessName}.`);
    return value;
  });
  return { name: template.name, language: template.language, parameters, body: renderTemplate(template.body, parameters), sourceBody: template.body };
}
export const renderedPayloadSchema = z.object({ name: z.string(), language: z.string(), parameters: z.array(z.string()), body: z.string(), sourceBody: z.string(), providerMode: z.enum(["mock", "cloud"]), templateFingerprint: z.string() });
export const launchSchema = z.object({ confirmation: z.string(), expectedEligible: z.number().int().positive(), scheduledAt: z.string().datetime({ offset: true }).nullable().optional() }).strict();
export const classificationSchema = z.object({ responseClassification: z.enum(["INTERESTED", "NOT_INTERESTED", "NEEDS_FOLLOWUP", "ORDER_CONFIRMED", "NO_RESPONSE", "OTHER"]), orderReference: z.string().trim().max(100).optional(), orderValue: z.number().nonnegative().max(1e12).optional(), currency: z.string().regex(/^[A-Z]{3}$/).default("INR"), notes: z.string().trim().max(1000).optional() }).strict();
export function transitionAllowed(status: string, action: string) {
  return action === "pause" ? ["SCHEDULED", "QUEUED", "SENDING"].includes(status) : action === "resume" ? status === "PAUSED" : action === "cancel" ? ["DRAFT", "SCHEDULED", "QUEUED", "SENDING", "PAUSED"].includes(status) : false;
}
