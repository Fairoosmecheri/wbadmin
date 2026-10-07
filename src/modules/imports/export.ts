import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { stringify } from "csv-stringify/sync";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/authorization";
import { AppError } from "@/lib/api";
import { resolveCustomerFilter } from "@/modules/segments/service";
import { buildCustomerWhere, customerFilterSchema } from "@/modules/customers/filters";
import { safeSpreadsheetValue } from "./files";

export const exportSchema = z.object({ format: z.enum(["csv", "xlsx"]).default("csv"), ids: z.array(z.string().min(1).max(100)).min(1).max(10000).optional(), filters: customerFilterSchema.default({}) });
const include = { area: true, route: true, customerType: true, assignedUser: { select: { name: true, email: true } }, tags: { include: { tag: true } } } satisfies Prisma.CustomerInclude;
type Customer = Prisma.CustomerGetPayload<{ include: typeof include }>;
const headers = ["Customer Code", "Business Name", "Contact Person", "Phone", "Normalized Phone", "Alternate Phone", "Email", "Customer Type", "Area", "Route", "Salesman", "Salesman Email", "Status", "WhatsApp Opt-In", "WhatsApp Opt-In Source", "Opt-In At", "Opt-Out At", "Opt-Out Reason", "Tags", "Address Line 1", "Address Line 2", "City", "District", "State", "Postal Code", "Country", "Notes", "Last Contacted", "Last Order", "Created At"];
function cells(c: Customer) {
  return [c.customerCode, c.businessName, c.contactPerson, c.phone, c.phoneNormalized, c.alternatePhone, c.email, c.customerType?.name, c.area?.name, c.route?.name, c.assignedUser?.name, c.assignedUser?.email, c.status, c.whatsappOptIn ? "yes" : "no", c.whatsappOptInSource, c.whatsappOptInAt, c.whatsappOptOutAt, c.whatsappOptOutReason, c.tags.map(t => t.tag.name).join("; "), c.addressLine1, c.addressLine2, c.city, c.district, c.state, c.postalCode, c.country, c.notes, c.lastContactedAt, c.lastOrderDate, c.createdAt].map(safeSpreadsheetValue);
}
export async function exportCustomers(input: unknown, actor: Actor): Promise<Response> {
  const raw = z.object({ format: z.unknown().optional(), ids: z.unknown().optional(), filters: z.unknown().default({}) }).parse(input);
  const data = exportSchema.parse({ ...raw, filters: await resolveCustomerFilter(raw.filters, actor) });
  const where: Prisma.CustomerWhereInput = { AND: [buildCustomerWhere(data.filters, actor), ...(data.ids ? [{ id: { in: [...new Set(data.ids)] } }] : [])] };
  const total = await prisma.customer.count({ where });
  if (total > 100000) throw new AppError(422, "Narrow your filters to export up to 100,000 customers at a time.");
  const stream = new PassThrough();
  const exportedAt = new Date();
  const cutoffWhere = { AND: [where, { createdAt: { lte: exportedAt } }] };
  // Database cursors and streaming workbook output keep large exports off browser memory.
  async function* rows() {
    let cursor: string | undefined;
    while (true) {
      const batch: Customer[] = await prisma.customer.findMany({ where: cutoffWhere, include, orderBy: { id: "asc" }, take: 500, ...(cursor && { cursor: { id: cursor }, skip: 1 }) });
      if (!batch.length) break;
      for (const customer of batch) yield cells(customer);
      cursor = batch[batch.length - 1].id;
      if (stream.destroyed) break;
    }
  }
  const run = async () => {
    if (data.format === "csv") {
      stream.write("\ufeff" + stringify([headers]));
      for await (const row of rows()) {
        if (!stream.write(stringify([row]))) await once(stream, "drain");
      }
      stream.end();
    } else {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: false, useSharedStrings: false });
      const sheet = workbook.addWorksheet("Customers");
      sheet.addRow(headers).commit();
      for await (const row of rows()) sheet.addRow(row).commit();
      sheet.commit();
      await workbook.commit();
    }
  };
  void run().catch(error => stream.destroy(error instanceof Error ? error : new Error("Export failed")));
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { "Content-Type": data.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="customers-${exportedAt.toISOString().slice(0, 10)}.${data.format}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
