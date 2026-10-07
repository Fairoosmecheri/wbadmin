import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { Prisma, type ImportBatch } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api";
import { assertRole, type Actor } from "@/lib/authorization";
import { getGeneralSettings } from "@/modules/auth/settings";
import { parseSpreadsheet, makeCsv, type Spreadsheet } from "./files";
import { mappingSchema, commitSchema, inferMapping, validateImportRows, type ImportCatalog, type NormalizedImportRow } from "./validation";

type StoredRows = Spreadsheet & { validated?: NormalizedImportRow[] };
type ReportRow = { row: number; outcome: "inserted" | "updated" | "skipped" | "invalid"; reason: string };
export type ImportReport = { inserted: number; updated: number; skipped: number; invalid: number; rows: ReportRow[] };
const batchSummary = { id: true, fileName: true, uploadedBy: true, totalRows: true, validRows: true, invalidRows: true, duplicateRows: true, insertedRows: true, updatedRows: true, skippedRows: true, status: true, createdAt: true, completedAt: true, updatedAt: true } satisfies Prisma.ImportBatchSelect;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const stored = (batch: ImportBatch) => batch.rows as unknown as StoredRows;
const batchWhere = (id: string, actor: Actor) => ({ id, ...(actor.role !== "ADMIN" && { uploadedBy: actor.id }) });

async function catalog(db: Prisma.TransactionClient = prisma): Promise<ImportCatalog> {
  const [areas, routes, customerTypes, tags, users] = await Promise.all([
    db.area.findMany({ where: { active: true }, select: { id: true, name: true } }),
    db.route.findMany({ where: { active: true }, select: { id: true, name: true } }),
    db.customerType.findMany({ where: { active: true }, select: { id: true, name: true } }),
    db.tag.findMany({ where: { active: true }, select: { id: true, name: true } }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true } }),
  ]);
  return { areas, routes, customerTypes, tags, users };
}
async function requireBatch(id: string, actor: Actor, db: Prisma.TransactionClient = prisma) {
  assertRole(actor, "ADMIN", "MANAGER");
  const batch = await db.importBatch.findFirst({ where: batchWhere(id, actor) });
  if (!batch) throw new AppError(404, "Import not found.");
  return batch;
}
export async function listImports(actor: Actor) {
  assertRole(actor, "ADMIN", "MANAGER");
  return prisma.importBatch.findMany({ where: actor.role === "ADMIN" ? {} : { uploadedBy: actor.id }, select: batchSummary, orderBy: { createdAt: "desc" }, take: 30 });
}
export async function uploadImport(fileName: string, buffer: Buffer, actor: Actor) {
  assertRole(actor, "ADMIN", "MANAGER");
  const spreadsheet = await parseSpreadsheet(fileName, buffer);
  const batch = await prisma.importBatch.create({ data: { fileName: fileName.slice(0, 255), uploadedBy: actor.id, totalRows: spreadsheet.rows.length, rows: json(spreadsheet), mapping: json(inferMapping(spreadsheet.headers)) } });
  return getImport(batch.id, actor);
}
export async function getImport(id: string, actor: Actor, page = 1, only = "all") {
  const batch = await requireBatch(id, actor), data = stored(batch);
  const validated = data.validated ?? [];
  const visible = only === "duplicates" ? validated.filter(r => r.duplicate?.kind === "existing" && !r.errors.length) : only === "invalid" ? validated.filter(r => r.errors.length) : validated;
  const offset = (Math.max(1, page) - 1) * 50;
  const { rows: _rows, report: rawReport, ...summary } = batch;
  void _rows;
  const report = batch.status === "COMPLETED" ? rawReport as unknown as ImportReport : null;
  return { ...summary, validationToken: batch.updatedAt.toISOString(), headers: data.headers, preview: data.rows.slice(0, 5), validated: visible.slice(offset, offset + 50), page, pages: Math.max(1, Math.ceil(visible.length / 50)), reviewCount: validated.filter(r => r.duplicate?.kind === "existing" && !r.errors.length).length, report: report ? { ...report, rows: report.rows.slice(offset, offset + 50) } : null };
}
async function attachExisting(rows: NormalizedImportRow[], db: Prisma.TransactionClient = prisma) {
  const phones = rows.map(r => r.data.phoneNormalized).filter((p): p is string => typeof p === "string");
  const codes = rows.map(r => r.data.customerCode).filter((p): p is string => typeof p === "string");
  const existing = await db.customer.findMany({ where: { OR: [{ phoneNormalized: { in: phones } }, { customerCode: { in: codes } }] }, select: { id: true, phoneNormalized: true, customerCode: true, businessName: true, updatedAt: true, archivedAt: true } });
  const byPhone = new Map(existing.map(c => [c.phoneNormalized, c])), byCode = new Map(existing.map(c => [c.customerCode, c]));
  for (const row of rows) {
    const match = byPhone.get(String(row.data.phoneNormalized));
    const codeMatch = row.data.customerCode && byCode.get(String(row.data.customerCode));
    if (codeMatch && codeMatch.id !== match?.id) row.errors.push("This customer code belongs to a different phone number. Resolve the conflict before importing.");
    if (match && !row.duplicate) {
      row.duplicate = { kind: "existing", id: match.id, businessName: match.businessName, updatedAt: match.updatedAt.toISOString() };
      if (match.archivedAt) row.errors.push("This phone belongs to an archived customer. Restore that customer separately before importing updates.");
    }
  }
}
export async function validateImport(id: string, input: unknown, actor: Actor) {
  const batch = await requireBatch(id, actor);
  if (!["UPLOADED", "VALIDATED"].includes(batch.status)) throw new AppError(409, "This import is already completed or being processed.");
  const mapping = mappingSchema.parse(input), data = stored(batch);
  if (!mapping.columns.businessName || !mapping.columns.phone) throw new AppError(422, "Map Business Name and Phone before validating.");
  const columns = Object.values(mapping.columns).filter(Boolean);
  if (columns.some(v => !data.headers.includes(v))) throw new AppError(422, "A mapped column does not exist in the file.");
  if (new Set(columns).size !== columns.length) throw new AppError(422, "Map each spreadsheet column to one customer field only.");
  const [options, settings] = await Promise.all([catalog(), getGeneralSettings()]);
  const validated = validateImportRows(data.headers, data.rows, mapping, options, settings.defaultPhoneCountry);
  await attachExisting(validated);
  const result = await prisma.importBatch.updateMany({ where: { id, updatedAt: batch.updatedAt, status: { in: ["UPLOADED", "VALIDATED"] } }, data: {
    status: "VALIDATED", mapping: json(mapping), rows: json({ headers: data.headers, rows: data.rows, validated }),
    validRows: validated.filter(r => !r.errors.length).length, invalidRows: validated.filter(r => r.errors.length).length, duplicateRows: validated.filter(r => r.duplicate).length,
  } });
  if (!result.count) throw new AppError(409, "This import changed while validating. Refresh and try again.");
  return getImport(id, actor);
}

/** Explicit choices and a compare-and-swap batch claim make retries safe and stale previews reject. */
export async function commitImport(id: string, input: unknown, actor: Actor) {
  assertRole(actor, "ADMIN", "MANAGER");
  const options = commitSchema.parse(input);
  return prisma.$transaction(async tx => {
    const batch = await requireBatch(id, actor, tx);
    if (batch.status === "COMPLETED") return batch.report as unknown as ImportReport;
    if (batch.status !== "VALIDATED" || batch.updatedAt.toISOString() !== options.validationToken) throw new AppError(409, "The validation is outdated. Validate and review the import again.");
    const claimed = await tx.importBatch.updateMany({ where: { id, status: "VALIDATED", updatedAt: new Date(options.validationToken) }, data: { status: "PROCESSING" } });
    if (claimed.count !== 1) throw new AppError(409, "This import was submitted elsewhere. Refresh its report.");
    const data = stored(batch), validated = data.validated;
    if (!validated) throw new AppError(409, "Validate this import first.");
    const reviews = validated.filter(r => !r.errors.length && r.duplicate?.kind === "existing");
    if (options.duplicateMode === "review" && reviews.some(r => !options.decisions[String(r.row)])) throw new AppError(422, "Choose Skip or Update for every existing customer before importing.");
    // Re-check all phones, unique codes, and classifications inside the same transaction.
    const mapping = mappingSchema.parse(batch.mapping);
    const settingsRecord = await tx.setting.findUnique({ where: { key: "general" } });
    const country = settingsRecord?.value && typeof settingsRecord.value === "object" && "defaultPhoneCountry" in settingsRecord.value ? String(settingsRecord.value.defaultPhoneCountry) : undefined;
    const current = validateImportRows(data.headers, data.rows, mapping, await catalog(tx), country);
    await attachExisting(current, tx);
    for (let i = 0; i < validated.length; i++) {
      const previous = validated[i], fresh = current[i];
      if (previous.errors.length || previous.duplicate?.kind === "file") continue;
      if (fresh.errors.length || !isDeepStrictEqual(previous.data, fresh.data) || !isDeepStrictEqual(previous.duplicate, fresh.duplicate)) throw new AppError(409, `Customer data changed after validation (row ${previous.row}). Validate and review again; nothing was imported.`);
    }
    const report: ImportReport = { inserted: 0, updated: 0, skipped: 0, invalid: 0, rows: [] };
    const creates: Prisma.CustomerCreateManyInput[] = [], tagCreates: Prisma.CustomerTagCreateManyInput[] = [], activities: Prisma.ActivityLogCreateManyInput[] = [];
    for (const row of validated) {
      if (row.errors.length) { report.invalid++; report.rows.push({ row: row.row, outcome: "invalid", reason: row.errors.join(" ") }); continue; }
      const duplicate = row.duplicate;
      if (duplicate?.kind === "file" || duplicate && (options.duplicateMode === "skip" || options.duplicateMode === "review" && options.decisions[String(row.row)] === "skip")) {
        report.skipped++; report.rows.push({ row: row.row, outcome: "skipped", reason: duplicate.kind === "file" ? `Repeated phone from row ${duplicate.row}.` : "Existing customer skipped by your choice." }); continue;
      }
      const { tagIds, ...fields } = row.data;
      const values = fields as unknown as Prisma.CustomerUncheckedCreateInput;
      const consent = values.whatsappOptIn === true ? { whatsappOptInAt: new Date(), whatsappOptOutAt: null, whatsappOptOutReason: null } : values.whatsappOptIn === false ? { whatsappOptOutAt: new Date(), whatsappOptOutReason: "Explicit opt-out supplied in customer import" } : {};
      const customerId = duplicate?.id || randomUUID();
      if (duplicate?.id) {
        const changed = await tx.customer.updateMany({ where: { id: duplicate.id, updatedAt: new Date(duplicate.updatedAt!) }, data: { ...values, ...consent } });
        if (!changed.count) throw new AppError(409, "A customer changed while importing. Validate and review again.");
        if (Array.isArray(tagIds)) await tx.customerTag.deleteMany({ where: { customerId } });
        report.updated++; report.rows.push({ row: row.row, outcome: "updated", reason: "Updated explicitly selected non-empty fields." });
      } else {
        creates.push({ ...values, ...consent, id: customerId, customerCode: values.customerCode || `C-${randomUUID().slice(0, 12).toUpperCase()}` });
        report.inserted++; report.rows.push({ row: row.row, outcome: "inserted", reason: "Customer created." });
      }
      if (Array.isArray(tagIds)) tagCreates.push(...tagIds.map(tagId => ({ customerId, tagId })));
      activities.push({ customerId, userId: actor.id, type: duplicate ? "CUSTOMER_IMPORTED_UPDATE" : "CUSTOMER_IMPORTED", description: duplicate ? "Customer explicitly updated from spreadsheet import" : "Customer added from spreadsheet import", entityType: "ImportBatch", entityId: id });
      if (values.whatsappOptIn !== undefined) activities.push({ customerId, userId: actor.id, type: values.whatsappOptIn ? "OPT_IN" : "OPT_OUT", description: values.whatsappOptIn ? `Explicit import permission: ${values.whatsappOptInSource}` : "Explicit opt-out supplied in import", entityType: "ImportBatch", entityId: id });
    }
    for (let start = 0; start < creates.length; start += 250) await tx.customer.createMany({ data: creates.slice(start, start + 250) });
    for (let start = 0; start < tagCreates.length; start += 1000) await tx.customerTag.createMany({ data: tagCreates.slice(start, start + 1000), skipDuplicates: true });
    for (let start = 0; start < activities.length; start += 1000) await tx.activityLog.createMany({ data: activities.slice(start, start + 1000) });
    await tx.importBatch.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(), duplicateMode: options.duplicateMode, insertedRows: report.inserted, updatedRows: report.updated, skippedRows: report.skipped + report.invalid, report: json(report) } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "customers.imported", entityType: "ImportBatch", entityId: id, metadata: { inserted: report.inserted, updated: report.updated, invalid: report.invalid, skipped: report.skipped, duplicateMode: options.duplicateMode } } });
    return report;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 120000 });
}
export async function failedImportCsv(id: string, actor: Actor) {
  const batch = await requireBatch(id, actor), data = stored(batch);
  if (!data.validated) throw new AppError(409, "Validate this import before downloading failed rows.");
  return makeCsv([...data.headers, "Import errors"], data.validated.filter(r => r.errors.length).map(r => [...data.rows[r.row - 2], r.errors.join(" ")]));
}
export const importPageSchema = z.coerce.number().int().min(1).max(100000).default(1);
