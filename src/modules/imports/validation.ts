import { z } from "zod";
import { normalizePhone } from "@/modules/customers/phone";

export const importFields = ["customerCode", "businessName", "contactPerson", "phone", "alternatePhone", "email", "area", "route", "customerType", "salesman", "tags", "addressLine1", "addressLine2", "city", "district", "state", "postalCode", "country", "whatsappOptIn", "whatsappOptInSource", "notes"] as const;
export type ImportField = typeof importFields[number];
export const mappingSchema = z.object({ columns: z.partialRecord(z.enum(importFields), z.string().max(300)), consentSource: z.string().trim().max(300).default("") });
export type ImportMapping = z.infer<typeof mappingSchema>;
export const commitSchema = z.object({ duplicateMode: z.enum(["skip", "update", "review"]), decisions: z.record(z.string(), z.enum(["skip", "update"])).default({}), confirmed: z.literal(true), validationToken: z.iso.datetime() });
export type CommitOptions = z.infer<typeof commitSchema>;
export type Lookup = { id: string; name: string };
export type ImportCatalog = { areas: Lookup[]; routes: Lookup[]; customerTypes: Lookup[]; tags: Lookup[]; users: (Lookup & { email: string })[] };
export type NormalizedImportRow = { row: number; values: Record<string, string>; data: Record<string, string | boolean | string[]>; errors: string[]; warnings: string[]; duplicate?: { kind: "file" | "existing"; id?: string; row?: number; businessName?: string; updatedAt?: string } };

export function inferMapping(headers: string[]): ImportMapping {
  const aliases: Record<ImportField, string[]> = {
    customerCode: ["customercode", "code"], businessName: ["businessname", "business", "company", "customername"], contactPerson: ["contactperson", "contact", "name"], phone: ["phone", "mobile", "phonenumber", "whatsappnumber"], alternatePhone: ["alternatephone", "alternatemobile"], email: ["email", "emailaddress"], area: ["area"], route: ["route"], customerType: ["customertype", "type"], salesman: ["salesman", "salesperson", "assigneduser", "salesmanemail"], tags: ["tags", "tag"], addressLine1: ["address", "addressline1"], addressLine2: ["addressline2"], city: ["city"], district: ["district"], state: ["state"], postalCode: ["postalcode", "pincode", "pin", "zipcode"], country: ["country"], whatsappOptIn: ["whatsappoptin", "optin", "consent"], whatsappOptInSource: ["whatsappoptinsource", "optinsource", "consentsource"], notes: ["notes"],
  };
  const columns: ImportMapping["columns"] = {};
  for (const field of importFields) { const match = headers.find(header => aliases[field].includes(header.toLowerCase().replace(/[^a-z0-9]/g, ""))); if (match) columns[field] = match; }
  return { columns, consentSource: "" };
}

export function validateImportRows(headers: string[], rows: string[][], mapping: ImportMapping, catalog: ImportCatalog, country?: string): NormalizedImportRow[] {
  const seen = new Map<string, number>();
  const seenCodes = new Map<string, number>();
  return rows.map((cells, index) => {
    const result: NormalizedImportRow = { row: index + 2, values: {}, data: {}, errors: [], warnings: [] };
    const { values, data, errors, warnings } = result;
    for (const field of importFields) { const header = mapping.columns[field]; if (header) values[field] = cells[headers.indexOf(header)]?.trim() ?? ""; }
    if (!values.businessName || values.businessName.length < 2 || values.businessName.length > 200) errors.push("Business name must contain 2–200 characters.");
    if (!values.phone) errors.push("Phone is required.");
    else try { data.phone = values.phone; data.phoneNormalized = normalizePhone(values.phone, country); } catch { errors.push("Phone is not a valid number for the configured country."); }
    if (values.alternatePhone) try { data.alternatePhone = normalizePhone(values.alternatePhone, country); } catch { errors.push("Alternate phone is invalid."); }
    if (values.email && !z.email().safeParse(values.email).success) errors.push("Email is invalid.");
    for (const field of ["customerCode", "businessName", "contactPerson", "email", "addressLine1", "addressLine2", "city", "district", "state", "postalCode", "country", "notes"] as const) {
      if (values[field]) { const limit = field === "notes" ? 10000 : ["addressLine1", "addressLine2"].includes(field) ? 500 : field === "customerCode" ? 60 : field === "postalCode" ? 30 : 200; if (values[field].length > limit) errors.push(`${field} exceeds ${limit} characters.`); else data[field] = values[field]; }
    }
    const lookups = [["area", "areaId", catalog.areas], ["route", "routeId", catalog.routes], ["customerType", "customerTypeId", catalog.customerTypes], ["salesman", "assignedUserId", catalog.users]] as const;
    for (const [field, target, options] of lookups) {
      if (!values[field]) continue;
      const matches = options.filter(option => option.name.toLowerCase() === values[field].toLowerCase() || ("email" in option && String(option.email).toLowerCase() === values[field].toLowerCase()));
      if (matches.length !== 1) errors.push(`${field} “${values[field]}” is unknown or ambiguous. Add it in Settings or use the salesman's unique email.`);
      else data[target] = matches[0].id;
    }
    if (values.tags) {
      const tagIds: string[] = [];
      for (const name of values.tags.split(/[,;|]/).map(v => v.trim()).filter(Boolean)) {
        const tag = catalog.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (tag) tagIds.push(tag.id); else errors.push(`Tag “${name}” does not exist. Add it in Settings first.`);
      }
      data.tagIds = [...new Set(tagIds)];
    }
    if (values.whatsappOptIn) {
      const consent = values.whatsappOptIn.toLowerCase();
      if (["true", "yes", "1"].includes(consent)) {
        const source = values.whatsappOptInSource || mapping.consentSource;
        if (!source || source.length > 300) errors.push("Explicit WhatsApp opt-in requires a consent source of 1–300 characters.");
        else { data.whatsappOptIn = true; data.whatsappOptInSource = source; }
      } else if (["false", "no", "0"].includes(consent)) data.whatsappOptIn = false;
      else errors.push("WhatsApp opt-in must be yes/true/1 or no/false/0; permission is never inferred.");
    } else warnings.push("No explicit WhatsApp permission supplied; existing consent will remain unchanged, new customers stay opted out.");
    if (typeof data.phoneNormalized === "string") {
      const earlier = seen.get(data.phoneNormalized);
      if (earlier !== undefined) { result.duplicate = { kind: "file", row: earlier }; warnings.push(`Same normalized phone as row ${earlier}; this later row will be skipped.`); }
      else seen.set(data.phoneNormalized, result.row);
    }
    if (values.customerCode) {
      const earlier = seenCodes.get(values.customerCode);
      if (earlier !== undefined && result.duplicate?.row !== earlier) errors.push(`Customer code is repeated from row ${earlier} with a different phone.`);
      else seenCodes.set(values.customerCode, result.row);
    }
    return result;
  });
}
