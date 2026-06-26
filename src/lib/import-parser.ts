/**
 * CSV / XLSX import parser. Client-side only (so the list never passes through the server).
 *
 * Two-stage structure:
 *  1) analyzeImportFile — read the file into a grid and auto-infer column roles (email/name/first/last).
 *     Headers are recognized via synonym matching (Full Name, First Name, E-mail Address, 성명 …).
 *  2) buildRecipients — build Recipient[] from the (user-corrected) role array.
 *     first+last is composed as "First Last"; if there are multiple name columns, join them in order.
 */
import * as XLSX from "xlsx";
import { isValidEmail, type Recipient } from "./recipients";

export type ColumnRole = "email" | "name" | "first" | "last" | "ignore";

export type ImportAnalysis = {
  /** Trimmed string grid (including the header row). */
  grid: string[][];
  hasHeader: boolean;
  /** Column labels — original headers if present, otherwise like "열 1". */
  columnLabels: string[];
  /** Auto-inferred column roles. Correctable in the UI. */
  roles: ColumnRole[];
  sheetNames: string[];
  sheetName: string;
  fileName: string;
};

export type ImportReport = {
  rows: Recipient[];
  errors: { row: number; reason: string; raw: string }[];
  totalRowsRead: number;
};

// ── Header synonyms (normalize: lowercase + strip whitespace/underscore/hyphen/parens) ──
function normalizeHeader(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[\s_\-()./]+/g, "");
}
const EMAIL_KEYS = new Set([
  "email", "emails", "emailaddress", "emailaddr", "mail", "mailaddress",
  "이메일", "이메일주소", "메일", "메일주소", "전자우편",
]);
const NAME_KEYS = new Set([
  "name", "fullname", "displayname", "recipientname",
  "이름", "성명", "성함", "수신자", "수신자명", "고객명", "담당자", "담당자명",
]);
const FIRST_KEYS = new Set(["firstname", "givenname", "first", "preferredname"]);
const LAST_KEYS = new Set(["lastname", "surname", "familyname", "last", "성"]);

function roleFromHeader(cell: string): ColumnRole | null {
  const n = normalizeHeader(cell);
  if (!n) return null;
  if (EMAIL_KEYS.has(n)) return "email";
  if (NAME_KEYS.has(n)) return "name";
  if (FIRST_KEYS.has(n)) return "first";
  if (LAST_KEYS.has(n)) return "last";
  return null;
}

/** Max row length — use a loop since spread risks call-stack overflow on very large files. */
function maxCols(grid: string[][]): number {
  let cols = 0;
  for (const r of grid) if (r.length > cols) cols = r.length;
  return cols;
}

/** Count of valid emails per column (sampling up to 20 data rows). */
function emailScoreByColumn(grid: string[][], startRow: number): number[] {
  const cols = maxCols(grid);
  const scores = new Array(cols).fill(0);
  const end = Math.min(grid.length, startRow + 20);
  for (let i = startRow; i < end; i++) {
    for (let c = 0; c < cols; c++) {
      if (isValidEmail(String(grid[i]?.[c] ?? "").trim())) scores[c]++;
    }
  }
  return scores;
}

/** Grid → header presence + auto-infer column roles. */
export function analyzeGrid(rawGrid: any[][], meta: { sheetNames: string[]; sheetName: string; fileName: string }): ImportAnalysis {
  const grid = rawGrid.map((r) => (r ?? []).map((c) => String(c ?? "").trim()));
  const cols = maxCols(grid);
  const empty: ImportAnalysis = {
    grid, hasHeader: false, columnLabels: [], roles: [], ...meta,
  };
  if (grid.length === 0 || cols === 0) return empty;

  const first = grid[0];
  const headerRoles = first.map((c) => roleFromHeader(c));
  const knownHeaderCount = headerRoles.filter(Boolean).length;
  const firstRowHasEmail = first.some((c) => isValidEmail(c));
  // Header decision: a known header word exists, or the first row has no email but rows below do.
  const dataHasEmail = emailScoreByColumn(grid, 1).some((s) => s > 0);
  const hasHeader = !firstRowHasEmail && (knownHeaderCount > 0 || (grid.length > 1 && dataHasEmail));

  const startRow = hasHeader ? 1 : 0;
  const roles: ColumnRole[] = new Array(cols).fill("ignore");

  if (hasHeader) {
    for (let c = 0; c < cols; c++) {
      const r = roleFromHeader(first[c] ?? "");
      if (!r) continue;
      if (r === "email" && roles.includes("email")) continue; // use only the first email column
      roles[c] = r;
    }
  }
  // If no email column was caught by header, infer by content (the column with the most valid emails).
  if (!roles.includes("email")) {
    const scores = emailScoreByColumn(grid, startRow);
    let best = -1, bestScore = 0;
    for (let c = 0; c < cols; c++) if (scores[c] > bestScore) { best = c; bestScore = scores[c]; }
    if (best >= 0) roles[best] = "email";
  }
  // Headerless 2-column data: treat the non-email column as the name.
  if (!hasHeader) {
    const emailIdx = roles.indexOf("email");
    if (emailIdx >= 0 && cols === 2) {
      const other = emailIdx === 0 ? 1 : 0;
      roles[other] = "name";
    }
  }
  // If there's a header but no name-type column was recognized and there are only 2 columns, treat the other as the name.
  if (hasHeader && cols === 2 && roles.includes("email") && !roles.some((r) => r === "name" || r === "first" || r === "last")) {
    const other = roles.indexOf("email") === 0 ? 1 : 0;
    roles[other] = "name";
  }

  const columnLabels = Array.from({ length: cols }, (_, c) =>
    hasHeader ? (first[c]?.trim() || `열 ${c + 1}`) : `열 ${c + 1}`
  );
  return { grid, hasHeader, columnLabels, roles, ...meta };
}

/** Build Recipient[] from the (corrected) role array. */
export function buildRecipients(analysis: ImportAnalysis, rolesOverride?: ColumnRole[]): ImportReport {
  const roles = rolesOverride ?? analysis.roles;
  const { grid, hasHeader } = analysis;
  const errors: ImportReport["errors"] = [];
  const rows: Recipient[] = [];
  const emailIdx = roles.indexOf("email");
  const startRow = hasHeader ? 1 : 0;
  if (emailIdx < 0) return { rows, errors, totalRowsRead: Math.max(0, grid.length - startRow) };

  const nameCols = roles.map((r, c) => ({ r, c })).filter((x) => x.r === "name").map((x) => x.c);
  const firstIdx = roles.indexOf("first");
  const lastIdx = roles.indexOf("last");

  for (let i = startRow; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const raw = row.join(" | ");
    const emailRaw = String(row[emailIdx] ?? "").trim();
    if (!emailRaw) {
      if (raw.trim()) errors.push({ row: i + 1, reason: "이메일 비어있음", raw });
      continue;
    }
    const email = emailRaw.toLowerCase();
    if (!isValidEmail(email)) {
      errors.push({ row: i + 1, reason: "이메일 형식 오류", raw });
      continue;
    }
    // Even when name and first/last columns coexist, compose them all (e.g. header [성, 이름] → prevent surname loss).
    // Korean surname+given is "성이름" order without a space (홍길동); otherwise "given last" order (Jane Doe).
    const joinedName = nameCols.map((c) => String(row[c] ?? "").trim()).filter(Boolean).join(" ");
    const fn = firstIdx >= 0 ? String(row[firstIdx] ?? "").trim() : "";
    const ln = lastIdx >= 0 ? String(row[lastIdx] ?? "").trim() : "";
    const given = [fn, joinedName].filter(Boolean).join(" ");
    const allHangul = (s: string) => /^[가-힣]+$/.test(s);
    let name = "";
    if (given && ln) name = allHangul(given) && allHangul(ln) ? `${ln}${given}` : `${given} ${ln}`;
    else name = given || ln;
    rows.push({ email, name: name || undefined });
  }
  return { rows, errors, totalRowsRead: grid.length - startRow };
}

/** File → analysis result (sheet selectable). Ignores extension/MIME, judges by content. */
export async function analyzeImportFile(file: File, sheetName?: string): Promise<ImportAnalysis> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", raw: false });
  const names = wb.SheetNames;
  const chosen = sheetName && names.includes(sheetName) ? sheetName : names[0];
  if (!chosen) return { grid: [], hasHeader: false, columnLabels: [], roles: [], sheetNames: [], sheetName: "", fileName: file.name };
  const sheet = wb.Sheets[chosen];
  const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "", blankrows: false });
  return analyzeGrid(grid, { sheetNames: names, sheetName: chosen, fileName: file.name });
}

/** Legacy compatibility: parse in one pass using auto-inference as-is. */
export async function parseImportFile(file: File): Promise<ImportReport> {
  const analysis = await analyzeImportFile(file);
  return buildRecipients(analysis);
}
