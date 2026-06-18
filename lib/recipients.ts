const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_EMAIL_RE = /([^,;\s<>"']+@[^,;\s<>"']+)\s*(?:>|$)/g;

export type Recipient = { email: string; name?: string };

/**
 * "홍길동 <a@b.com>" / "Name a@b.com" / "<a@b.com>" / raw 등 다양한 형식에서
 * 이메일을 안전하게 추출. 토큰화 전에 `<email>` 패턴을 먼저 추출하므로
 * 이름의 공백이 invalid를 만들지 않는다.
 */
function extractEmails(raw: string): string[] {
  const found: string[] = [];
  const angled: string[] = [];
  // 1차: "Name <email>" 또는 단독 <email> 형식
  for (const m of raw.matchAll(/<\s*([^<>]+?)\s*>/g)) {
    angled.push(m[1]);
  }
  let remainder = raw.replace(/<\s*[^<>]+?\s*>/g, " ");
  found.push(...angled);
  // 2차: 그 외 위치의 토큰 — 공백·쉼표·세미콜론·따옴표로 분리
  for (const t of remainder.split(/[\s,;"']+/)) {
    const v = t.trim().replace(/^[<"']+|[>"']+$/g, "");
    if (v) found.push(v);
  }
  return found;
}

/** 자유 텍스트(줄바꿈/쉼표/세미콜론/공백 혼합)에서 이메일 추출 + 중복 제거. */
export function parseRecipients(raw: string): {
  valid: string[];
  invalid: string[];
  duplicates: string[];
} {
  const tokens = extractEmails(raw);
  const valid: string[] = [];
  const invalid: string[] = [];
  const dupes: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const e = t.toLowerCase();
    if (!EMAIL_RE.test(e)) { invalid.push(t); continue; }
    if (seen.has(e)) { dupes.push(e); continue; }
    seen.add(e);
    valid.push(e);
  }
  return { valid, invalid, duplicates: dupes };
}

/** {email, name?} 배열을 dedupe (email 기준, lowercase). 첫 이름 보존. */
export function dedupeRecipients(items: Recipient[]): Recipient[] {
  const seen = new Map<string, Recipient>();
  for (const it of items) {
    const e = (it.email ?? "").toLowerCase().trim();
    if (!EMAIL_RE.test(e)) continue;
    if (seen.has(e)) continue;
    seen.set(e, { email: e, name: it.name?.trim() || undefined });
  }
  return [...seen.values()];
}

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(String(s ?? "").toLowerCase().trim());
}

// ── 그리드 붙여넣기 파서 (이름+이메일 매핑) ───────────────────────────────────
export type GridParseResult = {
  /** 유효한 수신자 (이메일 기준 dedupe, 첫 이름 보존). */
  rows: Recipient[];
  /** 이메일을 못 찾았거나 형식오류라 버린 줄. */
  ignored: { line: string; reason: string }[];
  /** 중복으로 제거된 이메일(lowercase). */
  duplicates: string[];
};

/** 한 셀에서 이메일/이름 추출. "홍길동 <a@b.com>" / "a@b.com" / "<a@b.com>" 지원. */
function cellToEmail(cell: string): { email: string | null; name: string | null } {
  const c = cell.trim();
  if (!c) return { email: null, name: null };
  // "이름 <addr>" 또는 "<addr>"
  const m = c.match(/^(.*?)<\s*([^<>]+?)\s*>$/);
  if (m) {
    const addr = m[2].replace(/^mailto:/i, "").trim().toLowerCase();
    if (EMAIL_RE.test(addr)) return { email: addr, name: m[1].trim() || null };
  }
  const bare = c.replace(/^mailto:/i, "").trim().toLowerCase();
  if (EMAIL_RE.test(bare)) return { email: bare, name: null };
  return { email: null, name: null };
}

/** 한 줄을 셀 배열로 분리. 탭 > 파이프 > 쉼표 우선, 없으면 공백 폴백.
 *  (탭·파이프·쉼표가 있으면 이름의 공백을 보존하기 위해 공백으로 자르지 않는다.) */
function splitCells(line: string): string[] {
  let s = line.trim();
  // 마크다운 표: 양끝 파이프 제거
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  let parts: string[];
  if (s.includes("\t")) parts = s.split("\t");
  else if (s.includes("|")) parts = s.split("|");
  else if (s.includes(",")) parts = s.split(",");
  else parts = s.split(/\s+/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** 마크다운 표 구분줄(`|---|:--:|`)인지. */
function isSeparatorRow(line: string): boolean {
  const s = line.trim();
  if (!s.includes("-")) return false;
  return /^\|?[\s:|-]+\|?$/.test(s) && s.replace(/[^-]/g, "").length > 0;
}

/** 헤더 키워드만 든 줄인지 (이메일 없음 + name/email 류 단어). */
function isHeaderRow(cells: string[]): boolean {
  const kw = new Set(["email", "e-mail", "mail", "이메일", "name", "이름", "성명"]);
  return cells.length > 0 && cells.every((c) => kw.has(c.toLowerCase()));
}

/**
 * 엑셀·구글시트·노션표·마크다운표·CSV 어디서 복사해도 이름+이메일을 매핑한다.
 * "형식을 맞추지 말고 이메일 모양으로 잡는다" — 각 줄에서 이메일 칸을 찾고 나머지를 이름으로.
 */
export function parseRecipientGrid(raw: string): GridParseResult {
  const ignored: GridParseResult["ignored"] = [];
  const collected: Recipient[] = [];
  const lines = String(raw ?? "").split(/\r\n|\r|\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isSeparatorRow(line)) continue;

    const cells = splitCells(line);
    if (isHeaderRow(cells)) continue;

    const emails: { email: string; angleName: string | null }[] = [];
    const others: string[] = [];
    for (const cell of cells) {
      const ce = cellToEmail(cell);
      if (ce.email) emails.push({ email: ce.email, angleName: ce.name });
      else others.push(cell);
    }

    if (emails.length === 0) {
      ignored.push({ line, reason: "이메일을 찾지 못함" });
      continue;
    }
    if (emails.length === 1) {
      const name = (emails[0].angleName ?? others.join(" ").trim()) || undefined;
      collected.push({ email: emails[0].email, name });
    } else {
      // 한 줄에 이메일이 여러 개면 각각 한 행으로 (나머지 셀이 누구 이름인지 모호하므로
      // angle-name 만 부착, 나머지는 이름 없이). 둘째 이후 주소가 사라지지 않게 한다.
      for (const e of emails) collected.push({ email: e.email, name: e.angleName ?? undefined });
    }
  }

  // dedupe (첫 이름 보존) + 중복 목록
  const seen = new Set<string>();
  const rows: Recipient[] = [];
  const duplicates: string[] = [];
  for (const r of collected) {
    if (seen.has(r.email)) { duplicates.push(r.email); continue; }
    seen.add(r.email);
    rows.push(r.name ? { email: r.email, name: r.name } : { email: r.email });
  }
  return { rows, ignored, duplicates };
}

/**
 * 자유텍스트에서 특정 이메일이 든 첫 줄을 찾아 그 사람의 이름만 교체한 텍스트를 반환.
 * (textarea 가 source of truth 이므로, 미리보기에서 이름을 고치면 텍스트 자체를 고쳐야
 *  서버 재파싱에도 반영된다.) 한 줄에 이메일이 여러 개면 한 명당 한 줄로 풀어쓴다.
 */
export function setNameInText(raw: string, email: string, name: string): string {
  const target = email.toLowerCase().trim();
  const fmt = (n: string | undefined, e: string) => (n?.trim() ? `${n.trim()}\t${e}` : e);
  const lines = String(raw ?? "").split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parsed = parseRecipientGrid(line);
    if (!parsed.rows.some((r) => r.email === target)) continue;
    const rebuilt = parsed.rows.map((r) => fmt(r.email === target ? name : r.name, r.email));
    lines.splice(i, 1, ...rebuilt);
    return lines.join("\n");
  }
  return raw;
}
