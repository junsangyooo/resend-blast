// Extract a fenced code block from model output (pure function).
export function extractFenced(text: string, lang: "json" | "html"): string | null {
  const re = lang === "json"
    ? /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/g   // json may omit the language tag
    : /```html[ \t]*\r?\n([\s\S]*?)```/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) last = m[1];
  const out = last?.trim();
  return out ? out : null;
}

// Assistant commentary to show in chat: only the part before the first code block.
export function commentaryBefore(text: string): string {
  const i = text.indexOf("```");
  return (i === -1 ? text : text.slice(0, i)).trim();
}
