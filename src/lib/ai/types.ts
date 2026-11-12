// lib/ai/types.ts — types shared by the AI studio client and server. No fs/SDK dependencies.
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ImageRef = { url: string; filename: string };
export type ComposeMode = "spec" | "html";
export type ComposeRequest = {
  mode: ComposeMode;
  messages: ChatMessage[];  // the last element is this user request
  current: unknown;         // spec mode: TemplateSpec / html mode: HTML string
  imageUrls: ImageRef[];
};
export type ComposeEvent =
  | { type: "text"; delta: string }
  | { type: "retry" }
  /** writing = the email code is being generated (chars so far); checking = format validation. */
  | { type: "progress"; phase: "writing" | "checking"; chars?: number }
  | { type: "result"; spec?: unknown; html?: string }
  | { type: "error"; message: string };
