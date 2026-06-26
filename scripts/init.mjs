// scripts/init.mjs — Interactive setup wizard orchestrator for Email Blast
// Wires together the pure modules in scripts/init/* to produce brand.config.ts + .env.local.
//
// Line-input approach:
//   All prompt reads go through createLineReader (scripts/init/line-reader.mjs) which
//   maintains a FIFO buffer + waiter queue over rl.on("line", ...) events. This avoids
//   the Node 24+ rl.question() hang under piped stdin AND correctly handles the theme-step
//   race where a browser pick must cancel a pending terminal read without swallowing the
//   next answer line.
//
// Password masking:
//   When process.stdin.isTTY, echo is suppressed via process.stdin.setRawMode() + manual
//   char-by-char reading (no extra readline interface). When not a TTY (piped), the line
//   is read plainly via the shared line reader (masking is meaningless on a pipe).

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { readFile, writeFile, copyFile, access, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";

import { THEMES, getTheme, appTokensFor } from "./init/themes.mjs";
import { isEmail, isDomain, suggestSenderDomain } from "./init/validate.mjs";
import { renderEnv } from "./init/render-env.mjs";
import { renderConfig } from "./init/render-config.mjs";
import { createLineReader } from "./init/line-reader.mjs";

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

// Single readline interface in non-terminal mode (compatible with piped and TTY stdin).
// Line input is driven entirely by createLineReader to avoid Node 24+ async-iterator issues.
const rl = createInterface({ input: stdin, output: stdout, terminal: false });
const lineReader = createLineReader(rl);

// Read the next line from stdin.
async function nextLine() {
  return lineReader.nextLine();
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

// Password masking:
//   - Not a TTY (piped): read plainly via the shared line reader.
//   - TTY: use setRawMode + char-by-char read so we can suppress echo without opening
//     a second readline interface (which would race with the shared one).
async function askMasked(q) {
  stdout.write(`${q} `);

  if (!process.stdin.isTTY) {
    // Piped — masking is pointless, just read normally.
    const a = await nextLine();
    return a;
  }

  // TTY — read raw, suppress echo, collect chars manually.
  return new Promise((resolve, reject) => {
    // Pause the readline interface so it doesn't consume the raw keystrokes.
    rl.pause();
    stdin.setRawMode(true);
    stdin.resume();

    let buf = "";

    function onData(chunk) {
      // Iterate over every byte in the chunk so that multi-character data events
      // (fast typing, paste, pseudo-TTY) are handled correctly. A single 'data'
      // event may contain multiple bytes; Enter may sit mid-chunk, and we must not
      // drop bytes before it or crash on bytes that appear after it.
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      for (let i = 0; i < bytes.length; i++) {
        const code = bytes[i];
        if (code === 13 || code === 10) {
          // Enter (CR or LF) — restore terminal state and resolve.
          // Remaining bytes in this chunk are ignored (harmless: a trailing
          // LF after CR, or any bytes that arrived after line-end).
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          stdin.pause();
          stdout.write("\n");
          rl.resume();
          resolve(buf);
          return;
        } else if (code === 3) {
          // Ctrl-C
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          stdin.pause();
          stdout.write("\n");
          rl.resume();
          reject(new Error("Ctrl-C during password input"));
          return;
        } else if (code === 127 || code === 8) {
          // Backspace — remove last character from buffer
          if (buf.length > 0) buf = buf.slice(0, -1);
        } else if (code >= 32) {
          buf += String.fromCharCode(code);
          stdout.write("*");
        }
      }
    }

    stdin.on("data", onData);
  });
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

    // cancelableRead holds the { promise, cancel } for the terminal-number race leg.
    let cancelableRead = null;

    const finish = (id) => {
      if (done) return;
      done = true;
      // Cancel the pending terminal read so the next prompt's line isn't swallowed.
      if (cancelableRead) cancelableRead.cancel();
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

    server.listen(0, "127.0.0.1", async () => {
      const url = `http://127.0.0.1:${server.address().port}/?token=${token}`;
      openBrowser(url);
      console.log(`\n  테마를 브라우저에서 고르세요: ${url}`);
      console.log(
        `  또는 번호 입력: ${THEMES.map((t, i) => `${i + 1}) ${t.name}`).join("   ")}`
      );

      // Loop: re-prompt on invalid number until a valid number OR browser pick.
      // Each iteration uses a cancelable read so a browser pick cleanly wins the race.
      while (!done) {
        stdout.write("  > ");
        cancelableRead = lineReader.nextLineCancelable();

        let ans;
        try {
          ans = await cancelableRead.promise;
        } catch {
          // stdin closed — close the server on the reject path so the process
          // does not hang with an open HTTP server.
          if (!done) {
            done = true;
            try { server.close(); } catch {}
            reject(new Error("stdin closed during theme selection"));
          }
          return;
        }

        if (done) return; // browser picked while we were awaiting

        const i = parseInt(ans, 10);
        if (i >= 1 && i <= THEMES.length) {
          finish(THEMES[i - 1].id);
        } else {
          // Invalid number — tell the user and loop to re-prompt.
          console.log(
            `  ⚠ 1~${THEMES.length} 사이의 번호를 입력하세요 (또는 브라우저에서 고르세요).`
          );
        }
      }
    });
  });
}

async function backupIfExists(file) {
  if (await exists(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = `${file}.bak.${stamp}`;
    await copyFile(file, dest);
    // Backups can contain secrets (.env.local) — restrict to owner-only.
    await chmod(dest, 0o600);
    console.log(`  기존 ${file} → 백업됨 (.bak.${stamp})`);
  }
}

async function preserveSessionSecret(envFile) {
  if (!(await exists(envFile))) return null;
  const txt = await readFile(envFile, "utf8");
  const m = txt.match(/^AUTH_SESSION_SECRET=(.+)$/m);
  // .trim() guards against a trailing \r (CRLF-edited env file) being captured into the secret.
  return m ? m[1].trim() : null;
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
  const brandFile = `${root}src/brand.config.ts`;
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
  // .env.local holds plaintext secrets (ACCESS_PASSWORD, AUTH_SESSION_SECRET) — owner-only.
  // chmod after write guarantees 0600 even when the file already existed (writeFile keeps old perms).
  await writeFile(envFile, renderEnv(v, sessionSecret));
  await chmod(envFile, 0o600);

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
