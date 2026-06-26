// scripts/init.mjs — Interactive setup wizard orchestrator for Email Blast
// Wires together the pure modules in scripts/init/* to produce brand.config.ts + .env.local.
//
// DEVIATION FROM BRIEF re: readline approach:
//   The brief uses rl.question() from node:readline/promises for all prompts.
//   Under Node 24+ with piped (non-TTY) stdin, rl.question() pauses the input stream
//   after reading one line and the subsequent .question() calls never resolve — causing
//   the wizard to hang after the first answer. The brief explicitly says to fix this.
//
//   Fix: We drive all line input via a single shared async iterator
//   (rl[Symbol.asyncIterator]()) backed by readline, and write prompts manually via
//   stdout.write(). This keeps exactly one readline interface on stdin and is compatible
//   with both piped and interactive (TTY) use. The pickTheme() prompt for the theme
//   number also uses the same iterator.
//
//   askMasked: Under piped/non-TTY stdin masking is skipped entirely (pointless on pipe).
//   Under TTY, we suppress echo via rl._writeToOutput swap on the single shared rl
//   instead of opening a second interface (which would swallow subsequent piped lines).

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile, copyFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";

import { THEMES, getTheme, appTokensFor } from "./init/themes.mjs";
import { isEmail, isDomain, suggestSenderDomain } from "./init/validate.mjs";
import { renderEnv } from "./init/render-env.mjs";
import { renderConfig } from "./init/render-config.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const exists = async (f) => {
  try {
    await access(f);
    return true;
  } catch {
    return false;
  }
};

// Single readline interface; driven via async iterator to avoid Node 24 rl.question() hang.
const rl = createInterface({ input: stdin, output: stdout, terminal: false });
const lineIter = rl[Symbol.asyncIterator]();

// Read the next line from stdin (shared iterator — never two consumers at once).
async function nextLine() {
  const { value, done } = await lineIter.next();
  if (done) throw new Error("stdin closed unexpectedly");
  return (value ?? "").trim();
}

async function ask(q, def) {
  stdout.write(def ? `${q} [${def}] ` : `${q} `);
  const a = await nextLine();
  return a || def || "";
}

async function askValid(q, def, ok, err) {
  while (true) {
    const a = await ask(q, def);
    if (ok(a)) return a;
    console.log(`  ⚠ ${err}`);
  }
}

// Password masking on the single shared rl to avoid a second interface.
// Under piped/non-TTY stdin we skip masking (pointless on pipe) and just ask plainly.
// Under TTY, mute stdout output for the typed characters.
async function askMasked(q) {
  const isTTY = process.stdin.isTTY;
  if (!isTTY) {
    // Piped input — masking is meaningless, just read the line normally.
    return await ask(q);
  }

  // TTY: mute echo during typing via _writeToOutput swap.
  // The first call includes the prompt text — let it through; suppress subsequent char echoes.
  let promptWritten = false;
  const origWrite = rl._writeToOutput ? rl._writeToOutput.bind(rl) : null;

  if (origWrite) {
    rl._writeToOutput = (str) => {
      if (!promptWritten) {
        origWrite(str);
        if (str.includes(q)) promptWritten = true;
      } else if (str === "\r\n" || str === "\n" || str === "\r") {
        origWrite(str);
      }
      // Suppress character echoes
    };
  }

  stdout.write(`${q} `);
  const a = await nextLine();

  if (origWrite) {
    rl._writeToOutput = origWrite;
  }
  stdout.write("\n");
  return a;
}

async function confirm(q, def = true) {
  const a = (await ask(`${q} (${def ? "Y/n" : "y/N"})`, "")).toLowerCase();
  if (!a) return def;
  return a.startsWith("y");
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "start"
      : "xdg-open";
  try {
    spawn(cmd, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    }).unref();
  } catch {}
}

async function pickTheme() {
  const token = randomBytes(8).toString("hex");
  let html = await readFile(p("./init/theme-picker.html"), "utf8");
  const inject = `window.__THEMES=${JSON.stringify(THEMES)};window.__TOKEN=${JSON.stringify(token)};`;
  html = html.replace("/*__INIT_INJECT__*/", inject);

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (id) => {
      if (done) return;
      done = true;
      try {
        server.close();
      } catch {}
      resolve(id);
    };

    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "POST" && u.pathname === "/select") {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => {
          try {
            const { theme, token: tk } = JSON.parse(b || "{}");
            if (tk !== token || !getTheme(theme)) {
              res.writeHead(403);
              res.end();
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
            finish(theme);
          } catch {
            res.writeHead(400);
            res.end();
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}/?token=${token}`;
      openBrowser(url);
      console.log(`\n  테마를 브라우저에서 고르세요: ${url}`);
      console.log(
        `  또는 번호 입력: ${THEMES.map((t, i) => `${i + 1}) ${t.name}`).join("   ")}`
      );
      // Race: terminal number input vs browser POST — both use the same async iterator.
      stdout.write("  > ");
      nextLine()
        .then((ans) => {
          const i = parseInt(ans.trim(), 10);
          if (i >= 1 && i <= THEMES.length) finish(THEMES[i - 1].id);
          // If invalid number, the browser click is the fallback (server stays open).
          // In piped mode a valid number is always expected.
        })
        .catch((err) => {
          // stdin closed without a valid number — reject so main() surfaces the error.
          if (!done) reject(err);
        });
    });
  });
}

async function backupIfExists(file) {
  if (await exists(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await copyFile(file, `${file}.bak.${stamp}`);
    console.log(`  기존 ${file} → 백업됨 (.bak.${stamp})`);
  }
}

async function preserveSessionSecret(envFile) {
  if (!(await exists(envFile))) return null;
  const txt = await readFile(envFile, "utf8");
  const m = txt.match(/^AUTH_SESSION_SECRET=(.+)$/m);
  return m ? m[1] : null;
}

function appTokensToValues(t) {
  return {
    appAccent: t.APP_ACCENT,
    appAccentBright: t.APP_ACCENT_BRIGHT,
    appAccentDeep: t.APP_ACCENT_DEEP,
  };
}

async function main() {
  console.log("\n=== Email Blast 설정 (npm run init) ===\n");
  const brandFile = `${root}brand.config.ts`;
  const envFile = `${root}.env.local`;

  if ((await exists(brandFile)) || (await exists(envFile))) {
    if (!(await confirm("기존 설정이 있습니다. 백업하고 새로 만들까요?", true))) {
      console.log("취소했습니다.");
      rl.close();
      return;
    }
  }

  const v = {};
  v.company = await ask("서비스/회사 이름?", "Acme");
  const mode = await ask("로그인 방식? (1) 비밀번호  (2) Google", "1");
  v.mode = mode === "2" ? "google" : "password";

  if (v.mode === "password") {
    v.accessPassword = await askMasked("접속 비밀번호?");
    v.operatorEmail = await askValid(
      "운영자 이메일(=관리자)?",
      "",
      isEmail,
      "이메일 형식이 아닙니다."
    );
    v.operatorName = v.company;
  } else {
    v.loginDomain = await askValid(
      "Google 로그인 허용 도메인?",
      "",
      isDomain,
      "도메인 형식이 아닙니다."
    );
    v.googleClientId = await ask("Google Client ID? (없으면 Enter)", "");
    v.googleClientSecret = await ask("Google Client Secret? (없으면 Enter)", "");
  }

  const themeId = await pickTheme();
  Object.assign(v, appTokensToValues(appTokensFor(themeId)));
  console.log(`  테마: ${getTheme(themeId).name}\n`);

  if (await confirm("지금 발송도 설정할까요?", false)) {
    v.senderDomain = await askValid(
      "발송 도메인 (Resend 인증된 도메인)?",
      suggestSenderDomain(v.operatorEmail || ""),
      isDomain,
      "도메인 형식이 아닙니다."
    );
    v.resendKey = await ask("Resend API 키? (없으면 Enter — 발송 전 도메인 인증 필요)", "");
    v.replyTo = await ask("답장 받을 주소?", "");
    v.legalName = await ask("법인명(컴플라이언스)?", `${v.company} Inc.`);
    v.postalAddress = await ask("우편주소(CAN-SPAM)?", "");
    v.contactEmail = await ask("문의 이메일?", "");
  }

  const template = await readFile(p("./init/brand.config.template.ts"), "utf8");
  const sessionSecret =
    (await preserveSessionSecret(envFile)) ||
    randomBytes(32).toString("base64url");

  console.log("\n--- 요약 ---");
  console.log(
    `  회사: ${v.company} | 로그인: ${v.mode} | 테마: ${getTheme(themeId).name}` +
      (v.senderDomain ? ` | 발송: ${v.senderDomain}` : " | 발송: 나중에")
  );
  if (!(await confirm("이대로 작성할까요?", true))) {
    console.log("취소했습니다.");
    rl.close();
    return;
  }

  await backupIfExists(brandFile);
  await backupIfExists(envFile);
  await writeFile(brandFile, renderConfig(template, v));
  await writeFile(envFile, renderEnv(v, sessionSecret));

  console.log("\n✓ 설정 완료!");
  console.log("  다음 단계 → 배포: docs/production.md");
  console.log("  (수정/미리보기: npm run dev → http://localhost:3001)\n");
  rl.close();
}

main().catch((e) => {
  console.error(e);
  rl.close();
  process.exit(1);
});
