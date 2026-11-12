/**
 * AI Studio authentication (server only).
 *
 * Order of precedence:
 *   1. API key registered in Settings → AI (stored in data/ai-settings.json, mode 0600, never sent to the browser)
 *   2. ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN in .env.local
 *   3. The server's Claude CLI login (the Agent SDK uses ~/.claude credentials)
 * If none works, the SDK call fails and the user sees a clear "register a key" message.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { atomicWrite, readJsonSafe, withFileLock } from "../atomic";
import { brand } from "../../brand.config";

const FILE = path.join(process.cwd(), "data", "ai-settings.json");

type Stored = { apiKey?: string; updatedAt?: string; updatedBy?: string };
export type AiAuthSource = "settings" | "env" | "cli";

/** Messages shown in the studio / settings (noun phrases, no explanations). */
export const AI_ERROR = {
  noAuth: "AI 사용 불가 · 설정 → AI에서 Claude API 키 등록 필요",
  badKey: "Claude API 키 오류 · 설정 → AI에서 키 확인",
  billing: "Claude 계정 결제·한도 문제 · 콘솔에서 확인",
  rateLimit: "AI 요청 한도 초과 · 잠시 후 재시도",
  generic: "AI 호출 실패 · 잠시 후 재시도",
} as const;

async function readStored(): Promise<Stored> {
  return readJsonSafe<Stored>(FILE, {});
}

/** Basic shape check only — the real check is "연결 확인" (an actual call). */
export function looksLikeApiKey(k: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k.trim());
}

export async function saveApiKey(apiKey: string, by: string): Promise<void> {
  await withFileLock(FILE, async () => {
    const data: Stored = { apiKey: apiKey.trim(), updatedAt: new Date().toISOString(), updatedBy: by };
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await atomicWrite(FILE, JSON.stringify(data, null, 2));
    await fs.chmod(FILE, 0o600).catch(() => {});
  });
}

export async function clearApiKey(): Promise<void> {
  await withFileLock(FILE, async () => {
    await fs.rm(FILE, { force: true });
  });
}

function envKeyPresent(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim());
}

/** Which credential the next AI call will use, and the env to pass to the SDK. */
export async function resolveAiAuth(): Promise<{ source: AiAuthSource; env: Record<string, string | undefined> }> {
  const stored = await readStored();
  if (stored.apiKey) {
    return { source: "settings", env: { ...process.env, ANTHROPIC_API_KEY: stored.apiKey, CLAUDE_CODE_OAUTH_TOKEN: undefined } };
  }
  if (envKeyPresent()) return { source: "env", env: { ...process.env } };
  // No key: let the CLI use its own login. Make sure an empty variable does not shadow it.
  return { source: "cli", env: { ...process.env, ANTHROPIC_API_KEY: undefined, CLAUDE_CODE_OAUTH_TOKEN: undefined } };
}

/** Status for Settings → AI (the key itself never leaves the server). */
export async function aiStatus(): Promise<{
  source: AiAuthSource;
  keyHint?: string;
  updatedAt?: string;
  updatedBy?: string;
  envKey: boolean;
  model: string;
}> {
  const stored = await readStored();
  const { source } = await resolveAiAuth();
  return {
    source,
    keyHint: stored.apiKey ? `…${stored.apiKey.slice(-4)}` : undefined,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
    envKey: envKeyPresent(),
    model: brand.ai.model,
  };
}

/** Error raised by an AI call, with a user-facing message already chosen. */
export class AiCallError extends Error {
  constructor(public userMessage: string, detail: string) {
    super(detail);
  }
}

/** Map an SDK failure (assistant `error` code, or result error text) to a user-facing message. */
export function toAiError(source: AiAuthSource, code: string | undefined, text: string): AiCallError {
  const t = `${code ?? ""} ${text}`.toLowerCase();
  const auth =
    code === "authentication_failed" ||
    /invalid api key|invalid x-api-key|authentication|unauthorized|401|please run \/login|not logged in|login required|oauth/.test(t);
  if (auth) return new AiCallError(source === "cli" ? AI_ERROR.noAuth : AI_ERROR.badKey, text || String(code));
  if (code === "billing_error" || /credit balance|billing/.test(t)) return new AiCallError(AI_ERROR.billing, text);
  if (code === "rate_limit" || /rate limit|429/.test(t)) return new AiCallError(AI_ERROR.rateLimit, text);
  return new AiCallError(AI_ERROR.generic, text || String(code));
}

/** Minimal call used by "연결 확인" — returns the source used, or throws AiCallError. */
export async function pingAi(timeoutMs = 60_000): Promise<{ source: AiAuthSource; ms: number }> {
  const { source, env } = await resolveAiAuth();
  const started = Date.now();
  const q = query({
    prompt: "Reply with exactly: pong",
    options: {
      model: brand.ai.model,
      systemPrompt: "You reply with exactly one word.",
      disallowedTools: ["*"],
      maxTurns: 1,
      cwd: os.tmpdir(),
      settingSources: [],
      env,
    },
  });
  const timer = setTimeout(() => q.interrupt().catch(() => {}), timeoutMs);
  let errCode: string | undefined;
  try {
    for await (const m of q) {
      if (m.type === "assistant" && m.error) errCode = m.error;
      if (m.type === "result") {
        if (m.subtype !== "success" || m.is_error || errCode) {
          throw toAiError(source, errCode, m.subtype === "success" ? m.result : m.subtype);
        }
        return { source, ms: Date.now() - started };
      }
    }
  } catch (e) {
    if (e instanceof AiCallError) throw e;
    throw toAiError(source, errCode, e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
  throw toAiError(source, errCode, "no result");
}
