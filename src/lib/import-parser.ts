/**
 * CSV / XLSX import parser. Client-side only (so the roster never passes through the server).
 *
 * Header recognition (case- and whitespace-insensitive): a column matching one of the synonyms below is used.
 *  email (required) · name (recommended) · company (optional) · title (optional). Other columns are ignored.
 * Only the first sheet is read, even if there are several.
 * CSV encoding: UTF-8 first; if it is not UTF-8, read as CP949 (EUC-KR, the Korean Excel default).
 */
import * as XLSX from "xlsx";
import { isValidEmail, type Recipient } from "./recipients";

const HEADER_SYNONYMS = {
  email: ["email", "e-mail", "mail", "email address", "이메일", "메일", "이메일주소", "이메일 주소", "메일주소", "메일 주소"],
  name: ["name", "full name", "이름", "성명", "성함", "담당자", "참석자"],
  company: ["company", "organization", "org", "affiliation", "회사", "회사명", "소속", "기관", "기관명"],
  title: ["title", "position", "job title", "role", "직함", "직책", "직위", "직급"],
} as const;
type Field = keyof typeof HEADER_SYNONYMS;

export type ImportResult =
  | {
      ok: true;
      recipients: Recipient[];
      /** Number of data rows, excluding the header. */
      totalRows: number;
      /** Number of rows skipped because the email was empty or malformed. */
      skipped: number;
      /** Which field columns were found (email is always true when ok is true). */
      fields: Record<Field, boolean>;
      /** Names of the other sheets that were not read (only the first sheet is read, so the UI shows a notice if any). */
      otherSheetNames: string[];
    }
  | { ok: false; error: string };

function normalizeHeader(s: string): string {
  return String(s ?? "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[_*]/g, "");
}

/** Grid (including the header row) → ImportResult. */
export function buildFromGrid(rawGrid: unknown[][], otherSheetNames: string[] = []): ImportResult {
  const grid = rawGrid.map((r) => (r ?? []).map((c) => String(c ?? "").trim()));
  if (grid.length === 0) return { ok: false, error: "파일에서 데이터를 찾지 못했습니다" };

  const header = grid[0].map(normalizeHeader);
  const colIndex: Partial<Record<Field, number>> = {};
  for (const f of Object.keys(HEADER_SYNONYMS) as Field[]) {
    const names: readonly string[] = HEADER_SYNONYMS[f];
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) colIndex[f] = idx;
  }

  if (colIndex.email === undefined) {
    return { ok: false, error: "이메일 열을 찾을 수 없습니다. 첫 행(머리글)에 'email' 또는 '이메일' 열이 있어야 해요." };
  }

  const recipients: Recipient[] = [];
  let skipped = 0;
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    if (row.every((c) => !c)) continue; // skip fully empty rows (not counted as errors)
    const emailRaw = String(row[colIndex.email] ?? "").trim().toLowerCase();
    if (!emailRaw || !isValidEmail(emailRaw)) { skipped++; continue; }
    const rec: Recipient = { email: emailRaw };
    if (colIndex.name !== undefined) rec.name = String(row[colIndex.name] ?? "").trim() || undefined;
    if (colIndex.company !== undefined) rec.company = String(row[colIndex.company] ?? "").trim() || undefined;
    if (colIndex.title !== undefined) rec.title = String(row[colIndex.title] ?? "").trim() || undefined;
    recipients.push(rec);
  }

  return {
    ok: true,
    recipients,
    totalRows: grid.length - 1,
    skipped,
    fields: {
      email: true,
      name: colIndex.name !== undefined,
      company: colIndex.company !== undefined,
      title: colIndex.title !== undefined,
    },
    otherSheetNames,
  };
}

/** File → ImportResult. Reads only the first sheet. */
export async function analyzeImportFile(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  const isCsv = /\.(csv|tsv|txt)$/i.test(file.name) || /csv|text\/plain/.test(file.type);
  // CSV: decode text ourselves — UTF-8 if valid, otherwise CP949 (Korean Excel's default "CSV" export).
  // XLSX is binary and carries its own encoding.
  const wb = isCsv
    ? XLSX.read(decodeCsv(buf), { type: "string", raw: false })
    : XLSX.read(buf, { type: "array", raw: false, codepage: 65001 });
  const first = wb.SheetNames[0];
  if (!first) return { ok: false, error: "파일에서 시트를 찾지 못했습니다" };
  const sheet = wb.Sheets[first];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  return buildFromGrid(grid, wb.SheetNames.slice(1));
}

/** UTF-8 when the bytes are valid UTF-8, else EUC-KR/CP949. */
export function decodeCsv(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    try { return new TextDecoder("euc-kr").decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
  }
}
