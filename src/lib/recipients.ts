const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Recipient = { email: string; name?: string; company?: string; title?: string };

/** Dedupe an array of {email, name?, company?, title?} (by email, lowercase). Keeps the first entry. */
export function dedupeRecipients(items: Recipient[]): Recipient[] {
  const seen = new Map<string, Recipient>();
  for (const it of items) {
    const e = (it.email ?? "").toLowerCase().trim();
    if (!EMAIL_RE.test(e)) continue;
    if (seen.has(e)) continue;
    seen.set(e, {
      email: e,
      name: it.name?.trim() || undefined,
      company: it.company?.trim() || undefined,
      title: it.title?.trim() || undefined,
    });
  }
  return [...seen.values()];
}

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(String(s ?? "").toLowerCase().trim());
}

// ── Grid paste parser (name + email mapping) ───────────────────────────────────
export type GridParseResult = {
  /** Valid recipients (deduped by email, first name kept). */
  rows: Recipient[];
  /** Lines dropped because no email was found or the format was invalid. */
  ignored: { line: string; reason: string }[];
  /** Emails removed as duplicates (lowercase). */
  duplicates: string[];
};

/** Extract email/name from one cell. Supports "홍길동 <a@b.com>" / "a@b.com" / "<a@b.com>". */
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

/** Split one line into an array of cells. Priority tab > pipe > comma, falling back to whitespace.
 *  (If tabs/pipes/commas are present, do not split on whitespace so spaces inside names are preserved.) */
function splitCells(line: string): string[] {
  let s = line.trim();
  // Markdown table: strip the pipes at both ends
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  let parts: string[];
  if (s.includes("\t")) parts = s.split("\t");
  else if (s.includes("|")) parts = s.split("|");
  else if (s.includes(",")) parts = s.split(",");
  else parts = s.split(/\s+/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Whether this is a Markdown table separator row (`|---|:--:|`). */
function isSeparatorRow(line: string): boolean {
  const s = line.trim();
  if (!s.includes("-")) return false;
  return /^\|?[\s:|-]+\|?$/.test(s) && s.replace(/[^-]/g, "").length > 0;
}

/** Whether the line contains only header keywords (no email + name/email-style words). */
function isHeaderRow(cells: string[]): boolean {
  const kw = new Set(["email", "e-mail", "mail", "이메일", "name", "이름", "성명"]);
  return cells.length > 0 && cells.every((c) => kw.has(c.toLowerCase()));
}

/**
 * Maps name + email whether copied from Excel, Google Sheets, a Notion table, a Markdown table, or CSV.
 * "Don't enforce a format; detect by email shape" — find the email cell on each line and treat the rest as the name.
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
      // If a line has several emails, make each its own row (the remaining cells are ambiguous about whose name they are,
      // so attach only the angle-name and leave the rest nameless). Keeps the second and later addresses from vanishing.
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
 * Find the first line containing a given email in free text and return the text with only that person's name replaced.
 * (The textarea is the source of truth, so a name fixed in the preview must be fixed in the text itself
 *  to survive server re-parsing.) If a line has several emails, expand it to one line per person.
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

/** base + extra by email (base order kept). Fills blank fields of existing members from extra. */
export function mergeMembers(base: Recipient[], extra: Recipient[]): { members: Recipient[]; added: number } {
  const byEmail = new Map<string, Recipient>();
  for (const m of base) byEmail.set(m.email.toLowerCase(), { ...m, email: m.email.toLowerCase() });
  let added = 0;
  for (const r of extra) {
    const e = String(r.email ?? "").toLowerCase().trim();
    if (!e || !isValidEmail(e)) continue;
    const cur = byEmail.get(e);
    if (!cur) { byEmail.set(e, { email: e, name: r.name, company: r.company, title: r.title }); added++; continue; }
    byEmail.set(e, {
      ...cur,
      name: cur.name?.trim() ? cur.name : r.name,
      company: cur.company?.trim() ? cur.company : r.company,
      title: cur.title?.trim() ? cur.title : r.title,
    });
  }
  return { members: dedupeRecipients(Array.from(byEmail.values())), added };
}

