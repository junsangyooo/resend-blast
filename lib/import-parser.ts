/**
 * CSV / XLSX 임포트 파서. 클라이언트 사이드에서만 사용 (서버에 명단 안 거치게).
 *
 * 2단계 구조:
 *  1) analyzeImportFile — 파일을 그리드로 읽고 컬럼 역할(email/name/first/last)을 자동 추론.
 *     헤더는 동의어 매칭(Full Name, First Name, E-mail Address, 성명 …)으로 인식.
 *  2) buildRecipients — (사용자가 교정한) 역할 배열로 Recipient[] 생성.
 *     first+last 는 "First Last" 로 합성, name 컬럼이 여럿이면 순서대로 join.
 */
import * as XLSX from "xlsx";
import { isValidEmail, type Recipient } from "./recipients";

export type ColumnRole = "email" | "name" | "first" | "last" | "ignore";

export type ImportAnalysis = {
  /** trim 된 문자열 그리드 (헤더 행 포함). */
  grid: string[][];
  hasHeader: boolean;
  /** 컬럼 라벨 — 헤더가 있으면 원문 헤더, 없으면 "열 1" 식. */
  columnLabels: string[];
  /** 자동 추론된 컬럼 역할. UI 에서 교정 가능. */
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

// ── 헤더 동의어 (normalize: 소문자 + 공백/언더스코어/하이픈/괄호 제거) ──
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

/** 행 길이 최대값 — 스프레드는 초대형 파일에서 call stack 초과 위험이 있어 루프로. */
function maxCols(grid: string[][]): number {
  let cols = 0;
  for (const r of grid) if (r.length > cols) cols = r.length;
  return cols;
}

/** 컬럼별 유효 이메일 개수 (데이터 행 기준 최대 20행 샘플). */
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

/** 그리드 → 헤더 여부 + 컬럼 역할 자동 추론. */
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
  // 헤더 판정: 알려진 헤더 단어가 있거나, 첫 행엔 이메일이 없는데 아래 행엔 있는 경우.
  const dataHasEmail = emailScoreByColumn(grid, 1).some((s) => s > 0);
  const hasHeader = !firstRowHasEmail && (knownHeaderCount > 0 || (grid.length > 1 && dataHasEmail));

  const startRow = hasHeader ? 1 : 0;
  const roles: ColumnRole[] = new Array(cols).fill("ignore");

  if (hasHeader) {
    for (let c = 0; c < cols; c++) {
      const r = roleFromHeader(first[c] ?? "");
      if (!r) continue;
      if (r === "email" && roles.includes("email")) continue; // 첫 이메일 컬럼만 사용
      roles[c] = r;
    }
  }
  // 이메일 컬럼이 헤더로 못 잡혔으면 내용으로 추론 (유효 이메일이 가장 많은 컬럼).
  if (!roles.includes("email")) {
    const scores = emailScoreByColumn(grid, startRow);
    let best = -1, bestScore = 0;
    for (let c = 0; c < cols; c++) if (scores[c] > bestScore) { best = c; bestScore = scores[c]; }
    if (best >= 0) roles[best] = "email";
  }
  // 헤더 없는 2열 데이터: 이메일 아닌 한 컬럼을 이름으로.
  if (!hasHeader) {
    const emailIdx = roles.indexOf("email");
    if (emailIdx >= 0 && cols === 2) {
      const other = emailIdx === 0 ? 1 : 0;
      roles[other] = "name";
    }
  }
  // 헤더가 있는데 이름류 컬럼이 하나도 인식 안 됐고 컬럼이 2개뿐이면 나머지를 이름으로.
  if (hasHeader && cols === 2 && roles.includes("email") && !roles.some((r) => r === "name" || r === "first" || r === "last")) {
    const other = roles.indexOf("email") === 0 ? 1 : 0;
    roles[other] = "name";
  }

  const columnLabels = Array.from({ length: cols }, (_, c) =>
    hasHeader ? (first[c]?.trim() || `열 ${c + 1}`) : `열 ${c + 1}`
  );
  return { grid, hasHeader, columnLabels, roles, ...meta };
}

/** (교정된) 역할 배열로 Recipient[] 생성. */
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
    // name 컬럼과 first/last 컬럼이 공존해도 모두 합성한다 (예: 헤더 [성, 이름] → 성 유실 방지).
    // 한글 성+이름은 공백 없이 "성이름" 순(홍길동), 그 외는 "given last" 순(Jane Doe).
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

/** 파일 → 분석 결과 (시트 선택 가능). 확장자/MIME 무관, 내용으로 자동 판단. */
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

/** 구버전 호환: 자동 추론 그대로 한 번에 파싱. */
export async function parseImportFile(file: File): Promise<ImportReport> {
  const analysis = await analyzeImportFile(file);
  return buildRecipients(analysis);
}
