// 모델 출력에서 fenced 코드블록 추출 (순수 함수).
export function extractFenced(text: string, lang: "json" | "html"): string | null {
  const re = lang === "json"
    ? /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/g   // json 은 언어태그 생략 허용
    : /```html[ \t]*\r?\n([\s\S]*?)```/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) last = m[1];
  const out = last?.trim();
  return out ? out : null;
}

// 채팅에 표시할 어시스턴트 코멘트 — 첫 코드블록 이전까지만.
export function commentaryBefore(text: string): string {
  const i = text.indexOf("```");
  return (i === -1 ? text : text.slice(0, i)).trim();
}
