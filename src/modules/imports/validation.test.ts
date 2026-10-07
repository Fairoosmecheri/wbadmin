import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { inferMapping, validateImportRows, commitSchema, type ImportCatalog } from "./validation";
import { parseSpreadsheet, safeSpreadsheetValue, makeCsv, makeWorkbook, inspectWorkbookArchive } from "./files";
const catalog: ImportCatalog = { areas: [], routes: [], customerTypes: [], tags: [], users: [] };
const headers = ["Business Name", "Phone", "WhatsApp Opt-In", "WhatsApp Opt-In Source"];

describe("customer spreadsheet validation", () => {
  it("normalizes local, international and 00 forms before checking duplicates", () => {
    const rows = validateImportRows(headers, [["First", "9876543210"], ["Second", "+91 98765 43210"], ["Third", "00919876543210"]], inferMapping(headers), catalog, "IN");
    expect(rows.map(row => row.data.phoneNormalized)).toEqual(["+919876543210", "+919876543210", "+919876543210"]);
    expect(rows[1].duplicate).toEqual({ kind: "file", row: 2 });
    expect(rows[2].duplicate).toEqual({ kind: "file", row: 2 });
  });
  it("requires explicit consent and source, never infers permission from a source alone", () => {
    const rows = validateImportRows(headers, [["Blank", "9876543210", "", "Customer form"], ["No source", "9876543211", "yes", ""], ["Explicit", "9876543212", "yes", "Signed form"], ["Opt out", "9876543213", "no", ""], ["Ambiguous", "9876543214", "maybe", "Signed form"]], inferMapping(headers), catalog, "IN");
    expect(rows[0].data.whatsappOptIn).toBeUndefined();
    expect(rows[1].errors.join()).toContain("requires a consent source");
    expect(rows[2].data).toMatchObject({ whatsappOptIn: true, whatsappOptInSource: "Signed form" });
    expect(rows[3].data.whatsappOptIn).toBe(false);
    expect(rows[4].errors.join()).toContain("never inferred");
  });
  it("rejects unknown classification names rather than creating dirty reference data", () => {
    const names = ["Business Name", "Phone", "Area", "Tags"];
    const [row] = validateImportRows(names, [["Example", "9876543210", "Unknown", "New tag"]], inferMapping(names), catalog);
    expect(row.errors).toHaveLength(2);
  });
  it("requires a current validation token and explicit import confirmation", () => {
    expect(commitSchema.safeParse({ duplicateMode: "update", confirmed: true }).success).toBe(false);
    expect(commitSchema.safeParse({ duplicateMode: "skip", confirmed: false, validationToken: new Date().toISOString() }).success).toBe(false);
  });
});

describe("spreadsheet files", () => {
  it("reads 1,000 XLSX records and detects normalized duplicates without browser processing", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Customers");
    sheet.addRow(headers);
    for (let index = 0; index < 1000; index++) sheet.addRow([`Customer ${index}`, `+91987${String(1000000 + index)}`, "no", ""]);
    sheet.addRow(["Duplicate", "9871000000", "no", ""]);
    const file = await parseSpreadsheet("customers.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()));
    const result = validateImportRows(file.headers, file.rows, inferMapping(file.headers), catalog, "IN");
    expect(result).toHaveLength(1001);
    expect(result.filter(r => r.errors.length)).toHaveLength(0);
    expect(result.filter(r => r.duplicate)).toHaveLength(1);
  });
  it("reads quoted CSV commas and multiline cells using the installed parser", async () => {
    const file = await parseSpreadsheet("customers.csv", Buffer.from('Business Name,Phone,Notes\r\n"Example, Ltd",9876543210,"Line one\nLine two"\r\n'));
    expect(file.rows).toEqual([["Example, Ltd", "9876543210", "Line one\nLine two"]]);
  });
  it("counts CSV records rather than physical lines, preserving multiline customer notes", async () => {
    const csv = "Business Name,Phone,Notes\n" + Array.from({ length: 1000 }, (_, i) => `Customer ${i},9876543210,"${Array.from({ length: 12 }, () => "note").join("\n")}"`).join("\n");
    expect((await parseSpreadsheet("notes.csv", Buffer.from(csv))).rows).toHaveLength(1000);
  });
  it("rejects formulas, duplicate headers, unsupported files and oversized CSV", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Customers");
    sheet.addRow(["Business Name", "Phone"]); sheet.addRow([{ formula: "1+1" }, "9876543210"]);
    await expect(parseSpreadsheet("formula.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toThrow("formulas");
    await expect(parseSpreadsheet("duplicate.csv", Buffer.from("Phone,Phone\n1,2"))).rejects.toThrow("unique");
    await expect(parseSpreadsheet("legacy.xls", Buffer.from("file"))).rejects.toThrow("Only CSV");
    await expect(parseSpreadsheet("huge.csv", Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow("10 MB");
  });
  it("rejects zip bombs even when central-directory declared sizes lie", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Customers");
    sheet.addRow(["Name"]); sheet.addRow(["A customer"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const directory = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buffer.writeUInt32LE(1, directory + 24);
    expect(() => inspectWorkbookArchive(buffer)).toThrow("invalid sizes");
  });
  it("neutralizes formula injection in CSV, reports, and XLSX exports", async () => {
    expect(safeSpreadsheetValue(" \t=HYPERLINK(\"bad\")")).toMatch(/^'/);
    expect(makeCsv(["Name"], [["=1+1"], ["+919876543210"]])).toContain("'=1+1");
    const bytes = await makeWorkbook(["Name"], [["=1+1"]]);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as never);
    expect(workbook.worksheets[0].getCell("A2").value).toBe("'=1+1");
  });
});
