import { NextRequest } from "next/server";
import os from "os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { requireUserEmail } from "@/lib/auth";
import { resolveAiAuth, toAiError, AiCallError, AI_ERROR, type AiAuthSource } from "@/lib/ai/auth";
import { brand } from "@/brand.config";
import { buildSystemPrompt, buildTurnPrompt } from "@/lib/ai/prompt";
import { validateSpec } from "@/lib/ai/spec-validate";
import { extractFenced } from "@/lib/ai/extract";
import type { ComposeEvent, ComposeRequest } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 400_000; // spec + history cap (an email spec is a few KB — generous margin)
const MAX_MESSAGES = 40;
const INFLIGHT_TTL_MS = 5 * 60_000;
const inFlight = new Map<string, number>(); // one concurrent request per user — value = start time (TTL prevents stale locks)

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

/** One SDK call. Emits text deltas, but nothing after the first ``` (code block) is streamed to the chat. */
async function runOnce(
  system: string, prompt: string, emit: (e: ComposeEvent) => void, signal: AbortSignal,
  auth: { source: AiAuthSource; env: Record<string, string | undefined> },
): Promise<string> {
  let full = "";
  let errCode: string | undefined;
  let sent = 0;
  let lastProgress = -1;
  const q = query({
    prompt,
    options: {
      model: brand.ai.model,
      systemPrompt: system,
      disallowedTools: ["*"],
      includePartialMessages: true,
      maxTurns: 1,
      cwd: os.tmpdir(),
      settingSources: [],
      env: auth.env,
    },
  });
  const onAbort = () => {
    q.interrupt().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const m of q) {
      if (m.type === "stream_event") {
        const ev = m.event;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          full += ev.delta.text;
          const cut = full.indexOf("```");
          let visible = cut === -1 ? full : full.slice(0, cut);
          if (cut === -1) {
            // hold back a trailing "`" or "``" — may be the start of a fence split across deltas
            const m = visible.match(/`{1,2}$/);
            if (m) visible = visible.slice(0, -m[0].length);
          }
          if (visible.length > sent) {
            emit({ type: "text", delta: visible.slice(sent) });
            sent = visible.length;
          }
          // The code block itself is not shown, but its progress is — otherwise the chat looks frozen
          // for the longest part of the request.
          if (cut !== -1) {
            const chars = full.length - cut;
            if (lastProgress < 0 || chars - lastProgress >= 200) {
              emit({ type: "progress", phase: "writing", chars });
              lastProgress = chars;
            }
          }
        }
      } else if (m.type === "assistant" && m.error) {
        errCode = m.error;
      } else if (m.type === "result") {
        // An API error (bad key, no login, billing…) ends the turn with is_error and the error text.
        if (m.subtype !== "success" || m.is_error || errCode) {
          throw toAiError(auth.source, errCode, m.subtype === "success" ? m.result : m.subtype);
        }
        if (!full) full = m.result;
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return full;
}

function parseResult(mode: "spec" | "html", text: string): { ok: true; ev: ComposeEvent } | { ok: false; errors: string[] } {
  if (mode === "html") {
    const html = extractFenced(text, "html");
    if (!html || !html.includes("<")) return { ok: false, errors: ["```html 코드블록에 수정된 HTML 전체를 담아 다시 출력"] };
    return { ok: true, ev: { type: "result", html } };
  }
  const raw = extractFenced(text, "json");
  if (!raw) return { ok: false, errors: ["```json 코드블록에 spec 전체를 담아 다시 출력"] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    return { ok: false, errors: [`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const v = validateSpec(parsed);
  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, ev: { type: "result", spec: v.spec } };
}

export async function POST(req: NextRequest) {
  let user: string;
  try {
    user = await requireUserEmail();
  } catch {
    return json({ error: "unauthenticated" }, 401);
  }
  // Auth (lib/ai/auth): Settings key → .env.local key → the server's Claude CLI login.
  // No hard guard here — without credentials the SDK call fails and an error event explains what to do.
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return json({ error: "요청이 너무 큽니다" }, 413);
  let body: ComposeRequest;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "잘못된 요청" }, 400);
  }
  if (body.mode !== "spec" && body.mode !== "html") return json({ error: "mode 는 spec|html" }, 400);
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES)
    return json({ error: `메시지는 1~${MAX_MESSAGES}개` }, 400);
  if (body.messages[body.messages.length - 1].role !== "user") return json({ error: "마지막 메시지는 user" }, 400);
  const startedAt = inFlight.get(user);
  if (startedAt !== undefined && Date.now() - startedAt < INFLIGHT_TTL_MS) return json({ error: "이전 요청 진행 중" }, 409);
  // Mark lock ownership with a stamp — so that after a new request takes the lock past the TTL, the old request's delete doesn't remove the new lock.
  const stamp = Date.now();
  inFlight.set(user, stamp);

  const system = buildSystemPrompt(body.mode);
  const turn = buildTurnPrompt({
    mode: body.mode,
    messages: body.messages,
    current: body.current,
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.slice(0, 20) : [],
  });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (e: ComposeEvent) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {}
      };
      try {
        const auth = await resolveAiAuth();
        let text = await runOnce(system, turn, emit, req.signal, auth);
        emit({ type: "progress", phase: "checking" });
        let r = parseResult(body.mode, text);
        if (!r.ok) {
          emit({ type: "retry" });
          const fixPrompt = `${turn}\n\n[직전 출력의 형식 오류 — 아래를 고쳐 같은 요청을 다시, 형식 엄수로 출력]\n${r.errors.join("\n")}`;
          text = await runOnce(system, fixPrompt, emit, req.signal, auth);
          emit({ type: "progress", phase: "checking" });
          r = parseResult(body.mode, text);
        }
        if (r.ok) emit(r.ev);
        else emit({ type: "error", message: "결과 형식 오류 · 요청 표현 변경 후 재시도" });
      } catch (e: unknown) {
        if (!req.signal.aborted) {
          console.error("[ai/compose]", e);
          emit({ type: "error", message: e instanceof AiCallError ? e.userMessage : AI_ERROR.generic });
        }
      } finally {
        if (inFlight.get(user) === stamp) inFlight.delete(user);
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      if (inFlight.get(user) === stamp) inFlight.delete(user);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" } });
}
