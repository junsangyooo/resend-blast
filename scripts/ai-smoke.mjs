// scripts/ai-smoke.mjs — Agent SDK 인증/호출 1회 검증. 실행:
//   set -a; source .env.local; set +a; node scripts/ai-smoke.mjs
import { query } from "@anthropic-ai/claude-agent-sdk";
import os from "os";

const auth = process.env.CLAUDE_CODE_OAUTH_TOKEN ? "CLAUDE_CODE_OAUTH_TOKEN"
  : process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "local CLI session (~/.claude 로그인)";
console.log("auth via:", auth);

let text = "";
for await (const m of query({
  prompt: "답변은 딱 한 단어: pong",
  options: {
    model: "claude-haiku-4-5",
    systemPrompt: "You reply with exactly one word.",
    disallowedTools: ["*"],
    maxTurns: 1,
    cwd: os.tmpdir(),
    settingSources: [],
  },
})) {
  if (m.type === "result") {
    if (m.subtype !== "success") { console.error("FAIL:", m.subtype); process.exit(1); }
    text = m.result;
  }
}
console.log("reply:", text.trim());
console.log(text.toLowerCase().includes("pong") ? "SMOKE OK" : "SMOKE WARN: unexpected reply");
