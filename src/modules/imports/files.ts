import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { AppError } from "@/lib/api";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10000;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
export type Spreadsheet = { headers: string[]; rows: string[][] };

/** Inspect central-directory sizes before ExcelJS inflates any workbook content. */
export function inspectWorkbookArchive(buffer: Buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new AppError(422, "The Excel workbook is not a valid XLSX archive.");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16), total = 0;
  if (count > 2000 || count === 0xffff) throw new AppError(422, "This workbook contains too many files. Export a simple worksheet instead.");
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new AppError(422, "The Excel archive is damaged.");
    const flags = buffer.readUInt16LE(cursor + 8), compressed = buffer.readUInt32LE(cursor + 20), expanded = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    total += expanded;
    if ((flags & 1) || expanded === 0xffffffff || total > MAX_EXPANDED_BYTES || (expanded > 1024 * 1024 && expanded / Math.max(1, compressed) > 250)) throw new AppError(422, "The workbook expands beyond the supported size. Export a smaller CSV or XLSX file.");
    if (/vbaProject|externalLinks/i.test(name)) throw new AppError(422, "Remove macros and external links before importing this workbook.");
    const method = buffer.readUInt16LE(cursor + 10), offset = buffer.readUInt32LE(cursor + 42);
    if (![0, 8].includes(method) || offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) throw new AppError(422, "Unsupported or damaged Excel archive.");
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    if (start + compressed > buffer.length) throw new AppError(422, "The Excel archive is incomplete.");
    // Verify actual expansion too: central-directory lengths alone are untrusted.
    try {
      const source = buffer.subarray(start, start + compressed);
      const actual = method === 0 ? source : inflateRawSync(source, { maxOutputLength: Math.max(1, Math.min(expanded + 1, MAX_EXPANDED_BYTES)) });
      if (actual.length !== expanded) throw new Error("Size mismatch");
    } catch { throw new AppError(422, "The workbook has invalid sizes or expands beyond the supported limit."); }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor > end) throw new AppError(422, "The Excel archive directory is invalid.");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) throw new AppError(422, "Replace spreadsheet formulas with their values before importing.");
    if ("richText" in value) return value.richText.map(t => t.text).join("");
    if ("text" in value) return value.text;
    if ("error" in value) throw new AppError(422, "The worksheet contains a cell error. Correct it before importing.");
  }
  return String(value);
}

export async function parseSpreadsheet(fileName: string, buffer: Buffer): Promise<Spreadsheet> {
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new AppError(413, "Choose a non-empty CSV or XLSX file up to 10 MB.");
  let cells: string[][];
  if (/\.csv$/i.test(fileName)) {
    try { cells = parse(buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: 200000, to: MAX_IMPORT_ROWS + 2 }) as string[][]; }
    catch { throw new AppError(422, "This CSV could not be read. Check its quoting and use UTF-8 encoding."); }
  } else if (/\.xlsx$/i.test(fileName)) {
    inspectWorkbookArchive(buffer);
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
    catch { throw new AppError(422, "This Excel workbook could not be read. Save it as a standard XLSX file."); }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new AppError(422, "The workbook has no worksheet.");
    if (sheet.rowCount > MAX_IMPORT_ROWS + 1 || sheet.columnCount > 100) throw new AppError(422, "Import at most 10,000 rows and 100 columns per file.");
    cells = [];
    sheet.eachRow({ includeEmpty: true }, row => { const values: string[] = []; for (let col = 1; col <= sheet.columnCount; col++) values.push(cellText(row.getCell(col).value)); cells.push(values); });
  } else throw new AppError(422, "Only CSV and XLSX files are supported.");
  if (cells.length < 2) throw new AppError(422, "Include a header row and at least one customer row.");
  if (cells.length > MAX_IMPORT_ROWS + 1 || cells.some(r => r.length > 100)) throw new AppError(422, "Import at most 10,000 rows and 100 columns per file.");
  if (cells.some(r => r.some(v => v.length > 10000))) throw new AppError(422, "A spreadsheet cell exceeds the 10,000 character limit.");
  const rawHeaders = cells.shift()!;
  const headers = rawHeaders.map((v, i) => v.trim() || `Column ${i + 1}`);
  if (new Set(headers).size !== headers.length) throw new AppError(422, "Column headers must be unique. Rename repeated headers before uploading.");
  const rows = cells.filter(r => r.some(v => v.trim())).map(r => headers.map((_, i) => r[i]?.trim() ?? ""));
  if (!rows.length) throw new AppError(422, "No customer rows were found.");
  if (cells.some(r => r.length > headers.length && r.slice(headers.length).some(v => v.trim()))) throw new AppError(422, "Some rows contain more values than column headers.");
  return { headers, rows };
}

/** Keep spreadsheet applications from evaluating user-controlled text as formulas. */
export function safeSpreadsheetValue(value: unknown): string {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  return /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
}
export function makeCsv(headers: string[], rows: unknown[][]) { return "\ufeff" + stringify([headers, ...rows].map(row => row.map(safeSpreadsheetValue))); }
export async function makeWorkbook(headers: string[], rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Customers", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row.map(value => safeSpreadsheetValue(value)));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF226949" } };
  sheet.columns.forEach(column => { column.width = 24; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
