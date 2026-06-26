const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_EMAIL_RE = /([^,;\s<>"']+@[^,;\s<>"']+)\s*(?:>|$)/g;

export type Recipient = { email: string; name?: string };

/**
 * Safely extract emails from various formats like "홍길동 <a@b.com>" / "Name a@b.com" /
 * "<a@b.com>" / raw. It extracts the `<email>` pattern before tokenizing, so spaces in
 * the name don't produce invalid tokens.
 */
function extractEmails(raw: string): string[] {
  const found: string[] = [];
  const angled: string[] = [];
  // Pass 1: "Name <email>" or standalone <email> form
  for (const m of raw.matchAll(/<\s*([^<>]+?)\s*>/g)) {
    angled.push(m[1]);
  }
  let remainder = raw.replace(/<\s*[^<>]+?\s*>/g, " ");
  found.push(...angled);
  // Pass 2: tokens elsewhere — split on whitespace/comma/semicolon/quotes
  for (const t of remainder.split(/[\s,;"']+/)) {
    const v = t.trim().replace(/^[<"']+|[>"']+$/g, "");
    if (v) found.push(v);
  }
  return found;
}

/** Extract emails from free text (mixed line breaks/commas/semicolons/whitespace) + dedupe. */
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

/** Dedupe a {email, name?} array (by email, lowercase). Keeps the first name. */
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

// ── Grid paste parser (name+email mapping) ───────────────────────────────────
export type GridParseResult = {
  /** Valid recipients (deduped by email, first name kept). */
  rows: Recipient[];
  /** Lines dropped because no email was found or it was malformed. */
  ignored: { line: string; reason: string }[];
  /** Emails removed as duplicates (lowercase). */
  duplicates: string[];
};

/** Extract email/name from a single cell. Supports "홍길동 <a@b.com>" / "a@b.com" / "<a@b.com>". */
function cellToEmail(cell: string): { email: string | null; name: string | null } {
  const c = cell.trim();
  if (!c) return { email: null, name: null };
  // "name <addr>" or "<addr>"
  const m = c.match(/^(.*?)<\s*([^<>]+?)\s*>$/);
  if (m) {
    const addr = m[2].replace(/^mailto:/i, "").trim().toLowerCase();
    if (EMAIL_RE.test(addr)) return { email: addr, name: m[1].trim() || null };
  }
  const bare = c.replace(/^mailto:/i, "").trim().toLowerCase();
  if (EMAIL_RE.test(bare)) return { email: bare, name: null };
  return { email: null, name: null };
}

/** Split a line into cells. Prefer tab > pipe > comma, falling back to whitespace.
 *  (When tab/pipe/comma is present, don't split on whitespace so name spaces are preserved.) */
function splitCells(line: string): string[] {
  let s = line.trim();
  // Markdown table: strip leading/trailing pipes
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  let parts: string[];
  if (s.includes("\t")) parts = s.split("\t");
  else if (s.includes("|")) parts = s.split("|");
  else if (s.includes(",")) parts = s.split(",");
  else parts = s.split(/\s+/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Whether this is a markdown table separator row (`|---|:--:|`). */
function isSeparatorRow(line: string): boolean {
  const s = line.trim();
  if (!s.includes("-")) return false;
  return /^\|?[\s:|-]+\|?$/.test(s) && s.replace(/[^-]/g, "").length > 0;
}

/** Whether the row holds only header keywords (no email + name/email-type words). */
function isHeaderRow(cells: string[]): boolean {
  const kw = new Set(["email", "e-mail", "mail", "이메일", "name", "이름", "성명"]);
  return cells.length > 0 && cells.every((c) => kw.has(c.toLowerCase()));
}

/**
 * Maps name+email no matter where it's copied from: Excel, Google Sheets, Notion tables,
 * markdown tables, CSV. "Don't enforce a format, just catch the email shape" — find the
 * email cell in each line and treat the rest as the name.
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
      // If a line has multiple emails, make each its own row (since it's ambiguous which
      // name the remaining cells belong to, attach only the angle-name, the rest without a
      // name). Ensures addresses after the first aren't lost.
      for (const e of emails) collected.push({ email: e.email, name: e.angleName ?? undefined });
    }
  }

  // dedupe (keep first name) + duplicate list
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
 * Find the first line in the free text containing a given email and return text with only
 * that person's name replaced. (Since the textarea is the source of truth, editing the name
 * in the preview must edit the text itself so server re-parsing reflects it.) If a line has
 * multiple emails, expand it to one line per person.
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
