import ExcelJS from "exceljs";
import { normalizeRow } from "./rowNormalizer";
import { CandidateHolding } from "./types";

export async function parseXlsx(buffer: Buffer): Promise<CandidateHolding[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const rawRows: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) obj[header] = cell.value;
    });
    if (Object.values(obj).some((v) => v !== null && v !== undefined && v !== "")) rawRows.push(obj);
  });

  const rows = await Promise.all(rawRows.map((row) => normalizeRow(row)));
  return rows.filter((r) => r.name);
}
