// lib/ai/types.ts — AI 스튜디오 클라·서버 공용 타입. fs/SDK 의존 금지.
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ImageRef = { url: string; filename: string };
export type ComposeMode = "spec" | "html";
export type ComposeRequest = {
  mode: ComposeMode;
  messages: ChatMessage[];  // 마지막 요소가 이번 사용자 요청
  current: unknown;         // spec 모드: TemplateSpec / html 모드: HTML 문자열
  imageUrls: ImageRef[];
};
export type ComposeEvent =
  | { type: "text"; delta: string }
  | { type: "retry" }
  | { type: "result"; spec?: unknown; html?: string }
  | { type: "error"; message: string };
