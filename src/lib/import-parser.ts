/**
 * CSV / XLSX 임포트 파서. 클라이언트 사이드에서만 사용 (서버에 명단 안 거치게).
 *
 * 헤더 인식 (대소문자·공백 무관): 아래 동의어 중 하나면 그 열로 본다.
 *  email(필수) · name(권장) · company(선택) · title(선택). 그 외 열은 무시.
 * 여러 시트가 있어도 첫 번째 시트만 읽는다.
 * CSV 인코딩: UTF-8 우선, UTF-8 이 아니면 CP949(EUC-KR, 한국어 Excel 기본)로 읽는다.
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
      /** 헤더 제외 데이터 행 수. */
      totalRows: number;
      /** 이메일이 비었거나 형식이 잘못돼 제외된 행 수. */
      skipped: number;
      /** 어떤 필드 열을 찾았는지 (email 은 ok:true 면 항상 true). */
      fields: Record<Field, boolean>;
      /** 읽지 않은 다른 시트 이름(첫 시트만 읽으므로, 있으면 UI 에서 안내). */
      otherSheetNames: string[];
    }
  | { ok: false; error: string };

function normalizeHeader(s: string): string {
  return String(s ?? "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[_*]/g, "");
}

/** 그리드(헤더 행 포함) → ImportResult. */
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
    if (row.every((c) => !c)) continue; // 완전 빈 행은 건너뜀 (오류 집계 안 함)
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

/** 파일 → ImportResult. 첫 번째 시트만 읽는다. */
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
