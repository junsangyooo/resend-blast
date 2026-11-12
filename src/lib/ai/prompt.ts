// lib/ai/prompt.ts — 시스템/턴 프롬프트 조립. 브랜드 값은 전부 brand.config 주입 — 하드코딩 금지.
import { brand } from "../../brand.config";
import { EXAMPLE_SPECS } from "./examples";
import type { ChatMessage, ComposeMode, ImageRef } from "./types";

const BLOCK_SCHEMA_DOC = `
각 블록: { "id": string(기존 블록 수정 시 유지, 신규는 생략 가능), "type": <아래 중 하나>, ...필드 }
- "kicker": 작은 대문자 라벨. { text }
- "heading": 제목. { text, subnote?(부제), size?("S"|"M"|"L") }
- "text": 본문 문단. { html } — html 에는 인라인 태그 허용: <strong> <em> <u> <s> <br> <a href="http…"> <span>. 그 외 태그 금지.
- "button": CTA 버튼. { label, url, topNote?, bottomNote?, arrow?(기본 false), btnColor?("mint"|"teal"|"ink") }
- "badge": 날짜/장소 강조 박스. { line1, line2?, line2Href?, label?(박스 안 버튼), url?, bottomNote? }
- "numbered": 번호 목록. { title?, titleNote?, items: [{ title, desc? | descHtml? }], bottomNote? }
- "agenda": 시간표. { title?, titleNote?, rows: [{ time, label }], bottomNote? }
- "grid": 카드 묶음. { cols(2|3), cardType("feature"|"image"|"stat"|"cta"), cards: [{ title?, desc?|descHtml?, img?, value?, btn?, url? }] }
- "image": { url(공개 URL만), alt?, caption?, title?, width?(px), href?, fullBleed?(배너용 풀폭) }
- "divider": 구분선. {}
공통 선택 필드(생략 = 위치 기반 자동, 웬만하면 생략): align("left"|"center"|"right"), size, gap("tight"|"sm"|""|"lg"), color("ink"|"body"|"teal"|"muted"), weight, font("sans"|"mono")
spec 루트: { "subject": 이메일 제목(필수), "preheader"?, "width"?("default"=600px|"wide"=680px), "showLogo": true, "showFooter": true, "tagline"?, "footer"?: { inquiryEmail?, showInquiry?, showOrgName?, showSocial?, showUnsubscribe?, orgName?, address? }, "blocks": [...] }
색·폰트·간격의 구체값은 렌더러가 결정한다 — hex/px 를 직접 쓰지 말고 토큰만 사용.`;

const PERSONALIZATION_DOC = `
개인화 토큰(발송 시 수신자별 치환 — 절대 제거/변형 금지): {{name}} {{firstName}} {{name|기본값}} {{email}} {{company}} {{title}}
푸터 수신거부 링크는 렌더러가 처리하므로 blocks 에 넣지 않는다.`;

export function buildSystemPrompt(mode: ComposeMode): string {
  const co = brand.identity.companyName;
  if (mode === "html") {
    return `당신은 ${co}의 이메일 HTML 편집 어시스턴트다. 사용자가 업로드한 기존 이메일 HTML 을 요청대로만 수정한다.
규칙:
- 요청된 변경 외의 마크업·문구·스타일은 바이트 단위로 그대로 보존한다.
- 이메일 클라이언트 호환 유지: 테이블 레이아웃과 인라인 스타일. <script>/외부 CSS 금지.
- 이미지 src 는 공개 URL(https)만. 개인화 토큰({{name}} 등)과 %%UNSUB_URL%% 은 그대로 둔다.
- 출력: 한국어로 1~3문장 코멘트 후, 수정된 HTML "전체"를 \`\`\`html 코드블록 하나에 담는다.`;
  }
  const fewshot = EXAMPLE_SPECS.map((e) =>
    `### 예시 — ${e.label}\n\`\`\`json\n${JSON.stringify(e.spec, null, 1)}\n\`\`\``).join("\n");
  return `당신은 ${co}의 이메일 작성 어시스턴트다. 사용자의 요청을 블록 spec(JSON)으로 만든다. 렌더링은 ${co} 디자인 시스템이 자동 처리하므로 spec 만 정확하면 항상 온브랜드다.

## 블록 스키마
${BLOCK_SCHEMA_DOC}
${PERSONALIZATION_DOC}

## 이미지
[사용 가능한 이미지] 목록의 URL 만 사용한다. 목록에 없는 이미지를 지어내지 않는다. 이미지가 어울리는 자리에 image 블록 또는 grid(cardType:"image")로 배치한다.

## 수정 규칙 (가장 중요)
[현재 spec] 이 주어지면 그 위에서 작업한다. 요청과 무관한 블록은 id 포함 글자 그대로 복사한다 — 문구를 다듬거나 순서를 바꾸지 않는다. 대대적 개편을 요청받은 경우에만 전체를 재구성한다.

## 출력 형식 (엄수)
1) 한국어 1~3문장으로 무엇을 했는지 코멘트. 2) 이어서 \`\`\`json 코드블록 "하나"에 완성된 spec 전체. 코드블록 뒤에 다른 텍스트 금지.

${fewshot}`;
}

export function buildTurnPrompt(req: { mode: ComposeMode; messages: ChatMessage[]; current: unknown; imageUrls: ImageRef[] }): string {
  const parts: string[] = [];
  const prior = req.messages.slice(0, -1);
  const lastUser = req.messages[req.messages.length - 1];
  if (prior.length) {
    parts.push("[이전 대화]");
    for (const m of prior) parts.push(`${m.role === "user" ? "사용자" : "어시스턴트"}: ${m.content}`);
  }
  if (req.mode === "spec") {
    parts.push("[현재 spec]", "```json", JSON.stringify(req.current ?? null, null, 1), "```");
  } else {
    parts.push("[현재 HTML]", "```html", String(req.current ?? ""), "```");
  }
  if (req.imageUrls.length) {
    parts.push("[사용 가능한 이미지]");
    for (const im of req.imageUrls) parts.push(`- ${im.filename}: ${im.url}`);
  }
  parts.push("[이번 요청]", lastUser?.content ?? "");
  return parts.join("\n");
}
