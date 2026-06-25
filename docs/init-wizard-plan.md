# Init 위저드 + 테마 프리셋 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run init` 한 번으로 질문에 답하면 `brand.config.ts` + `.env.local`이 채워져 앱이 부팅 가능해지고, 테마 색은 브라우저 팔레트 페이지에서 시각적으로 고른다.

**Architecture:** 순수 로직(테마 데이터·검증·파일 렌더링)을 `scripts/init/`의 작은 ESM 모듈로 분리해 vitest로 단위 테스트하고, 대화형 I/O(readline·http 콜백 서버·브라우저 오픈·파일 쓰기)는 `scripts/init.mjs` 오케스트레이터의 얇은 층에 모은다. `brand.config.ts`는 init 소유 템플릿에서 상단 `@init` 상수만 치환해 생성한다.

**Tech Stack:** Node 24 내장 모듈만(`readline/promises`, `crypto`, `http`, `child_process`, `fs/promises`), 테스트는 vitest 3.

## Global Constraints

- **의존성 0개.** Node 내장 모듈만 사용. `package.json` dependencies 추가 금지.
- **코드·주석·커밋 메시지: 영어. 사용자 대상 CLI 출력 문구: 한국어.**
- 테스트는 대상과 같은 폴더에 `*.test.mjs`로 작성 (vitest 기본 include가 수집).
- **시크릿 하드코딩 금지.** `AUTH_SESSION_SECRET`는 `crypto.randomBytes(32).toString('base64url')`로 생성.
- 순수 함수는 부수효과(파일 읽기·랜덤·시간) 주입받게 설계 — 랜덤/시크릿은 인자로 전달.
- 기존 `brand.config.ts`/`.env.local`은 무단 덮어쓰기 금지 — 타임스탬프 백업 후 진행.
- 테마는 `ui.appAccent*`만 바꾸고 `email.colors`는 불변.

---

## File Structure

**생성**
- `scripts/init/themes.mjs` — 6개 프리셋 단일 출처 + 매핑 (순수)
- `scripts/init/validate.mjs` — 이메일/도메인 검증 + 파생값 (순수)
- `scripts/init/render-env.mjs` — `.env.local` 문자열 생성 (순수)
- `scripts/init/render-config.mjs` — 템플릿 + 값 → `brand.config.ts` 문자열 (순수)
- `scripts/init/brand.config.template.ts` — 구 `brand.config.example.ts` 이동 + 디코플링 + `@init` 상수화
- `scripts/init/theme-picker.html` — 재사용 팔레트 페이지
- `scripts/init.mjs` — 오케스트레이터 (I/O)
- 각 순수 모듈의 `*.test.mjs`

**수정**
- `package.json` — `scripts.init` 추가
- `.gitignore` — 9번째 줄 주석의 셋업 안내를 `npm run init`로 갱신
- `docs/setup.md`, `docs/white-label.md` — 진입점을 `npm run init`로 갱신

**삭제**
- 루트 `brand.config.example.ts` (→ 템플릿으로 이동)

---

### Task 1: 테마 프리셋 데이터 (`themes.mjs`)

**Files:**
- Create: `scripts/init/themes.mjs`
- Test: `scripts/init/themes.test.mjs`

**Interfaces:**
- Produces:
  - `THEMES: Array<{id,name,vibe,accent,cta,deep,tint}>` (6개)
  - `getTheme(id) -> theme | undefined`
  - `appTokensFor(id) -> {APP_ACCENT, APP_ACCENT_BRIGHT, APP_ACCENT_DEEP}` (없는 id면 throw)

- [ ] **Step 1: Write the failing test**

```js
// scripts/init/themes.test.mjs
import { describe, it, expect } from "vitest";
import { THEMES, getTheme, appTokensFor } from "./themes.mjs";

describe("themes", () => {
  it("has 6 presets with unique ids and required hex fields", () => {
    expect(THEMES).toHaveLength(6);
    const ids = THEMES.map(t => t.id);
    expect(new Set(ids).size).toBe(6);
    for (const t of THEMES) {
      for (const k of ["accent", "cta", "deep"]) {
        expect(t[k]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
  it("indigo is the default baseline", () => {
    expect(getTheme("indigo")).toMatchObject({ accent: "#5b5bf0", cta: "#7c7cff", deep: "#4a4ad6" });
  });
  it("appTokensFor maps preset to app accent tokens", () => {
    expect(appTokensFor("ocean")).toEqual({
      APP_ACCENT: "#2563eb", APP_ACCENT_BRIGHT: "#3b82f6", APP_ACCENT_DEEP: "#1d4ed8",
    });
  });
  it("appTokensFor throws on unknown id", () => {
    expect(() => appTokensFor("nope")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/init/themes.test.mjs`
Expected: FAIL — `Cannot find module './themes.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/init/themes.mjs
// Single source of truth for theme presets. Consumed by both the init wizard
// and the browser palette page (theme-picker.html) so palette values never drift.
export const THEMES = [
  { id: "indigo",   name: "Indigo",   vibe: "테크·SaaS 기본",      accent: "#5b5bf0", cta: "#7c7cff", deep: "#4a4ad6", tint: "#eef0ff" },
  { id: "ocean",    name: "Ocean",    vibe: "신뢰·기업·클래식",    accent: "#2563eb", cta: "#3b82f6", deep: "#1d4ed8", tint: "#eff4ff" },
  { id: "emerald",  name: "Emerald",  vibe: "성장·친환경·헬스",    accent: "#0f9d6e", cta: "#14b886", deep: "#0a7d57", tint: "#e7f7f0" },
  { id: "crimson",  name: "Crimson",  vibe: "이벤트·강렬·리테일",  accent: "#e11d48", cta: "#f43f5e", deep: "#be123c", tint: "#ffeef1" },
  { id: "amber",    name: "Amber",    vibe: "따뜻함·F&B·캠페인",   accent: "#d97706", cta: "#f59e0b", deep: "#b45309", tint: "#fff4e2" },
  { id: "graphite", name: "Graphite", vibe: "미니멀·모노·프리미엄", accent: "#111827", cta: "#374151", deep: "#0b1220", tint: "#f0f1f3" },
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id);
}

export function appTokensFor(id) {
  const t = getTheme(id);
  if (!t) throw new Error(`unknown theme: ${id}`);
  return { APP_ACCENT: t.accent, APP_ACCENT_BRIGHT: t.cta, APP_ACCENT_DEEP: t.deep };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/init/themes.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/init/themes.mjs scripts/init/themes.test.mjs
git commit -m "feat(init): add theme preset data source"
```

---

### Task 2: 검증·파생 유틸 (`validate.mjs`)

**Files:**
- Create: `scripts/init/validate.mjs`
- Test: `scripts/init/validate.test.mjs`

**Interfaces:**
- Produces:
  - `isEmail(s) -> boolean`
  - `isDomain(s) -> boolean`
  - `domainOf(email) -> string` (`""` if none)
  - `suggestSenderDomain(email) -> string` (`send.<domain>` or `""`)
  - `builtinFrom(company, senderDomain) -> string` (`"Acme <hello@send.acme.com>"`)

- [ ] **Step 1: Write the failing test**

```js
// scripts/init/validate.test.mjs
import { describe, it, expect } from "vitest";
import { isEmail, isDomain, domainOf, suggestSenderDomain, builtinFrom } from "./validate.mjs";

describe("validate", () => {
  it("isEmail", () => {
    expect(isEmail("a@b.com")).toBe(true);
    expect(isEmail("nope")).toBe(false);
    expect(isEmail("a@b")).toBe(false);
  });
  it("isDomain", () => {
    expect(isDomain("acme.com")).toBe(true);
    expect(isDomain("send.acme.co.kr")).toBe(true);
    expect(isDomain("acme")).toBe(false);
  });
  it("domainOf", () => {
    expect(domainOf("you@acme.com")).toBe("acme.com");
    expect(domainOf("garbage")).toBe("");
  });
  it("suggestSenderDomain", () => {
    expect(suggestSenderDomain("you@acme.com")).toBe("send.acme.com");
    expect(suggestSenderDomain("garbage")).toBe("");
  });
  it("builtinFrom", () => {
    expect(builtinFrom("Acme", "send.acme.com")).toBe("Acme <hello@send.acme.com>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/init/validate.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/init/validate.mjs
export function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? "").trim());
}
export function isDomain(s) {
  return /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(s ?? "").trim());
}
export function domainOf(email) {
  const parts = String(email ?? "").trim().split("@");
  return parts.length === 2 && parts[1] ? parts[1] : "";
}
export function suggestSenderDomain(email) {
  const d = domainOf(email);
  return d ? `send.${d}` : "";
}
export function builtinFrom(company, senderDomain) {
  return `${company} <hello@${senderDomain}>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/init/validate.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/init/validate.mjs scripts/init/validate.test.mjs
git commit -m "feat(init): add input validation and derivation helpers"
```

---

### Task 3: `.env.local` 렌더러 (`render-env.mjs`)

**Files:**
- Create: `scripts/init/render-env.mjs`
- Test: `scripts/init/render-env.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `renderEnv(values, sessionSecret) -> string`
  - `values`: `{ mode, accessPassword?, googleClientId?, googleClientSecret?, resendKey? }`
  - `sessionSecret`: 호출자가 생성해 주입 (순수성 유지)

- [ ] **Step 1: Write the failing test**

```js
// scripts/init/render-env.test.mjs
import { describe, it, expect } from "vitest";
import { renderEnv } from "./render-env.mjs";

describe("renderEnv", () => {
  it("password mode writes ACCESS_PASSWORD + session secret, no google keys", () => {
    const out = renderEnv({ mode: "password", accessPassword: "1234" }, "SECRET");
    expect(out).toContain("ACCESS_PASSWORD=1234");
    expect(out).toContain("AUTH_SESSION_SECRET=SECRET");
    expect(out).not.toContain("GOOGLE_CLIENT_ID");
  });
  it("google mode writes google keys when present", () => {
    const out = renderEnv({ mode: "google", googleClientId: "cid", googleClientSecret: "csec" }, "S");
    expect(out).toContain("GOOGLE_CLIENT_ID=cid");
    expect(out).toContain("GOOGLE_CLIENT_SECRET=csec");
    expect(out).not.toContain("ACCESS_PASSWORD");
  });
  it("omits optional secrets left blank, includes resend key when given", () => {
    const out = renderEnv({ mode: "google", resendKey: "re_x" }, "S");
    expect(out).toContain("RESEND_EMAIL_TRACKING_API_KEY=re_x");
    expect(out).not.toContain("GOOGLE_CLIENT_ID");
    expect(out.endsWith("\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/init/render-env.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/init/render-env.mjs
// Pure: build the .env.local body. Secrets only. Session secret is injected
// by the caller so this stays deterministic and testable.
export function renderEnv(values, sessionSecret) {
  const lines = ["# Generated by `npm run init`. Secrets only — never commit this file."];
  if (values.mode === "password" && values.accessPassword) {
    lines.push(`ACCESS_PASSWORD=${values.accessPassword}`);
  }
  if (values.mode === "google") {
    if (values.googleClientId) lines.push(`GOOGLE_CLIENT_ID=${values.googleClientId}`);
    if (values.googleClientSecret) lines.push(`GOOGLE_CLIENT_SECRET=${values.googleClientSecret}`);
  }
  if (values.resendKey) lines.push(`RESEND_EMAIL_TRACKING_API_KEY=${values.resendKey}`);
  lines.push(`AUTH_SESSION_SECRET=${sessionSecret}`);
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/init/render-env.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/init/render-env.mjs scripts/init/render-env.test.mjs
git commit -m "feat(init): add .env.local renderer"
```

---

### Task 4: brand.config 템플릿 (이동 + 디코플링 + `@init` 상수화)

**Files:**
- Create: `scripts/init/brand.config.template.ts` (구 `brand.config.example.ts` 기반)
- Delete: `brand.config.example.ts`
- Test: `scripts/init/template-shape.test.mjs`

**Interfaces:**
- Produces: 템플릿 파일. 다음 `@init` 상수를 **모두 문자열 리터럴**로 선언해야 함 (Task 5의 `renderConfig`가 치환):
  `COMPANY, LEGAL_NAME, LOGIN_DOMAIN, SENDER_DOMAIN, AUTH_MODE, OPERATOR_EMAIL, OPERATOR_NAME, REPLY_TO_DEFAULT, POSTAL_ADDRESS_DEFAULT, CONTACT_EMAIL_DEFAULT, APP_ACCENT, APP_ACCENT_BRIGHT, APP_ACCENT_DEEP, EMAIL_PRIMARY, EMAIL_PRIMARY_CTA, EMAIL_TINT_BG, EMAIL_TINT_BORDER`

이 작업은 정적 파일 변환이라 로직 테스트 대신 **구조 검증 테스트**로 게이트한다.

- [ ] **Step 1: Write the failing test**

```js
// scripts/init/template-shape.test.mjs
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const tpl = await readFile(
  fileURLToPath(new URL("./brand.config.template.ts", import.meta.url)), "utf8"
);

const INIT_CONSTS = [
  "COMPANY","LEGAL_NAME","LOGIN_DOMAIN","SENDER_DOMAIN","AUTH_MODE",
  "OPERATOR_EMAIL","OPERATOR_NAME","REPLY_TO_DEFAULT","POSTAL_ADDRESS_DEFAULT",
  "CONTACT_EMAIL_DEFAULT","APP_ACCENT","APP_ACCENT_BRIGHT","APP_ACCENT_DEEP",
  "EMAIL_PRIMARY","EMAIL_PRIMARY_CTA","EMAIL_TINT_BG","EMAIL_TINT_BORDER",
];

describe("brand.config.template", () => {
  it("declares every @init const as a string literal", () => {
    for (const name of INIT_CONSTS) {
      expect(tpl).toMatch(new RegExp(`const\\s+${name}\\s*=\\s*"[^"]*"`));
    }
  });
  it("wires app accent tokens to APP_* (decoupled from email)", () => {
    expect(tpl).toMatch(/appAccent:\s*APP_ACCENT\b/);
    expect(tpl).toMatch(/appAccentDeep:\s*APP_ACCENT_DEEP\b/);
    expect(tpl).toMatch(/appAccentBright:\s*APP_ACCENT_BRIGHT\b/);
  });
  it("wires email colors to EMAIL_* (not APP_*)", () => {
    expect(tpl).toMatch(/teal:\s*EMAIL_PRIMARY\b/);
    expect(tpl).toMatch(/mint:\s*EMAIL_PRIMARY_CTA\b/);
  });
  it("auth.mode references AUTH_MODE const", () => {
    expect(tpl).toMatch(/mode:\s*AUTH_MODE\s+as/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/init/template-shape.test.mjs`
Expected: FAIL — template file not found

- [ ] **Step 3: Create the template from the current example with these changes**

1. `cp brand.config.example.ts scripts/init/brand.config.template.ts` then edit.
2. Replace the shared accent block. **Before:**

```ts
const PRIMARY        = "#5b5bf0";
const PRIMARY_CTA    = "#7c7cff";
const PRIMARY_DEEP   = "#4a4ad6";
...
const TINT_BG        = "#eef0ff";
const TINT_BORDER    = "#dce0ff";
```

**After:**

```ts
/* ── App theme (overwritten by `npm run init` with a preset) ── @init:theme */
const APP_ACCENT        = "#5b5bf0";   // → ui.appAccent       (--brand / --ring)
const APP_ACCENT_BRIGHT = "#7c7cff";   // → ui.appAccentBright  (--brand-mint)
const APP_ACCENT_DEEP   = "#4a4ad6";   // → ui.appAccentDeep    (--brand-deep / --rail)

/* ── Email colors (NOT touched by init; edit here for advanced personalization) ── */
const EMAIL_PRIMARY     = "#5b5bf0";   // → email.colors.teal
const EMAIL_PRIMARY_CTA = "#7c7cff";   // → email.colors.mint
const EMAIL_TINT_BG     = "#eef0ff";   // → email.colors.tealTintBg
const EMAIL_TINT_BORDER = "#dce0ff";   // → email.colors.tealTintBorder
```

3. Promote the auth/compliance values to top-level `@init` consts near the top:

```ts
const AUTH_MODE              = "password";          // @init  ("password" | "google")
const OPERATOR_EMAIL         = "you@example.com";   // @init  password-mode admin identity
const OPERATOR_NAME          = "Acme";              // @init  operator display name
const REPLY_TO_DEFAULT       = "inquiry@example.com"; // @init
const POSTAL_ADDRESS_DEFAULT = "";                  // @init  CAN-SPAM postal address
const CONTACT_EMAIL_DEFAULT  = "inquiry@example.com"; // @init
```
(`LEGAL_NAME` already a const — keep it; it stays `"Acme Inc."`.)

4. Rewire the object bodies to use the new consts:

```ts
// email.colors:
teal: EMAIL_PRIMARY,
mint: EMAIL_PRIMARY_CTA,
tealTintBg: EMAIL_TINT_BG,
tealTintBorder: EMAIL_TINT_BORDER,

// surfaces / neutrals: unchanged (TEXT_HEADING, HAIRLINE, etc. stay shared)

// auth:
mode: AUTH_MODE as "password" | "google",
operatorEmail: OPERATOR_EMAIL,
operatorName: OPERATOR_NAME,

// senders:
replyToDefault: REPLY_TO_DEFAULT,
postalAddress: process.env.SENDER_POSTAL_ADDRESS || POSTAL_ADDRESS_DEFAULT,
contactEmail: process.env.SENDER_CONTACT_EMAIL || CONTACT_EMAIL_DEFAULT,

// ui:
appAccent: APP_ACCENT,
appAccentDeep: APP_ACCENT_DEEP,
appAccentBright: APP_ACCENT_BRIGHT,
```

5. Update the file's top doc comment: replace "copy it to brand.config.ts" guidance with "Generated by `npm run init` — do not edit by hand unless personalizing."
6. `git rm brand.config.example.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/init/template-shape.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Verify the template still produces a working config (smoke)**

Run:
```bash
cp scripts/init/brand.config.template.ts brand.config.ts && npx tsc --noEmit -p tsconfig.json; echo "exit:$?"
```
Expected: no new type errors from `brand.config.ts` (exit 0, or only pre-existing unrelated errors). Then restore your dev config if changed.

- [ ] **Step 6: Commit**

```bash
git add scripts/init/brand.config.template.ts scripts/init/template-shape.test.mjs
git rm brand.config.example.ts
git commit -m "refactor(brand): move example to init template, decouple app theme from email colors"
```

---

### Task 5: brand.config 렌더러 (`render-config.mjs`)

**Files:**
- Create: `scripts/init/render-config.mjs`
- Test: `scripts/init/render-config.test.mjs`

**Interfaces:**
- Consumes: `appTokensFor` (Task 1), template string (Task 4)
- Produces:
  - `replaceConst(src, name, value) -> string` (없는 const면 throw)
  - `renderConfig(template, values) -> string`
    - `values`: `{ company, mode, operatorEmail?, operatorName?, loginDomain?, senderDomain?, legalName?, replyTo?, postalAddress?, contactEmail?, appAccent, appAccentBright, appAccentDeep }`

- [ ] **Step 1: Write the failing test**

```js
// scripts/init/render-config.test.mjs
import { describe, it, expect } from "vitest";
import { replaceConst, renderConfig } from "./render-config.mjs";

const TPL = [
  'const COMPANY = "Acme";',
  'const AUTH_MODE = "password";',
  'const OPERATOR_EMAIL = "you@example.com";',
  'const OPERATOR_NAME = "Acme";',
  'const SENDER_DOMAIN = "send.example.com";',
  'const APP_ACCENT = "#5b5bf0";',
  'const APP_ACCENT_BRIGHT = "#7c7cff";',
  'const APP_ACCENT_DEEP = "#4a4ad6";',
  'const EMAIL_PRIMARY = "#5b5bf0";',
].join("\n");

describe("replaceConst", () => {
  it("swaps the string literal of a named const", () => {
    expect(replaceConst('const COMPANY = "Acme";', "COMPANY", "RLWRLD"))
      .toBe('const COMPANY = "RLWRLD";');
  });
  it("throws when the const is absent", () => {
    expect(() => replaceConst("const X = 1;", "Y", "z")).toThrow();
  });
});

describe("renderConfig", () => {
  it("replaces collected values and theme tokens, leaves email untouched", () => {
    const out = renderConfig(TPL, {
      company: "RLWRLD", mode: "google", operatorEmail: "ops@rlwrld.ai",
      operatorName: "RLWRLD", senderDomain: "send.rlwrld.ai",
      appAccent: "#2563eb", appAccentBright: "#3b82f6", appAccentDeep: "#1d4ed8",
    });
    expect(out).toContain('const COMPANY = "RLWRLD";');
    expect(out).toContain('const AUTH_MODE = "google";');
    expect(out).toContain('const SENDER_DOMAIN = "send.rlwrld.ai";');
    expect(out).toContain('const APP_ACCENT = "#2563eb";');
    expect(out).toContain('const APP_ACCENT_DEEP = "#1d4ed8";');
    expect(out).toContain('const EMAIL_PRIMARY = "#5b5bf0";'); // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/init/render-config.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/init/render-config.mjs
// Pure: produce brand.config.ts by swapping the string literal of each @init
// const in the template. Only keys present in `values` are replaced; everything
// else (including EMAIL_* colors) keeps the template default.
export function replaceConst(src, name, value) {
  const re = new RegExp(`(const\\s+${name}\\s*=\\s*)"[^"]*"`);
  if (!re.test(src)) throw new Error(`@init const not found in template: ${name}`);
  return src.replace(re, `$1${JSON.stringify(value)}`);
}

export function renderConfig(template, values) {
  const map = {
    COMPANY: values.company,
    AUTH_MODE: values.mode,
    APP_ACCENT: values.appAccent,
    APP_ACCENT_BRIGHT: values.appAccentBright,
    APP_ACCENT_DEEP: values.appAccentDeep,
  };
  if (values.operatorEmail) map.OPERATOR_EMAIL = values.operatorEmail;
  if (values.operatorName || values.company) map.OPERATOR_NAME = values.operatorName || values.company;
  if (values.loginDomain) map.LOGIN_DOMAIN = values.loginDomain;
  if (values.senderDomain) map.SENDER_DOMAIN = values.senderDomain;
  if (values.legalName) map.LEGAL_NAME = values.legalName;
  if (values.replyTo) map.REPLY_TO_DEFAULT = values.replyTo;
  if (values.postalAddress != null) map.POSTAL_ADDRESS_DEFAULT = values.postalAddress;
  if (values.contactEmail) map.CONTACT_EMAIL_DEFAULT = values.contactEmail;

  let out = template;
  for (const [name, value] of Object.entries(map)) out = replaceConst(out, name, value);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/init/render-config.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/init/render-config.mjs scripts/init/render-config.test.mjs
git commit -m "feat(init): add brand.config renderer via template const replacement"
```

---

### Task 6: 팔레트 페이지 (`theme-picker.html`)

**Files:**
- Create: `scripts/init/theme-picker.html`
- Test: `scripts/init/theme-picker.test.mjs`

**Interfaces:**
- 페이지는 런타임에 주입되는 `window.__THEMES`(배열)·`window.__TOKEN`(문자열)을 사용.
- 카드 클릭 → `POST /select` with `{ theme, token }`.
- 주입 지점은 정확히 `/*__INIT_INJECT__*/` 플레이스홀더 (오케스트레이터가 치환).

- [ ] **Step 1: Write the failing test**

```js
// scripts/init/theme-picker.test.mjs
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const html = await readFile(
  fileURLToPath(new URL("./theme-picker.html", import.meta.url)), "utf8"
);

describe("theme-picker.html", () => {
  it("has the injection placeholder", () => {
    expect(html).toContain("/*__INIT_INJECT__*/");
  });
  it("reads injected themes/token, not a hardcoded list", () => {
    expect(html).toContain("window.__THEMES");
    expect(html).toContain("window.__TOKEN");
  });
  it("posts selection with token to /select", () => {
    expect(html).toMatch(/fetch\(\s*["']\/select["']/);
    expect(html).toMatch(/token:\s*window\.__TOKEN/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/init/theme-picker.test.mjs`
Expected: FAIL — file not found

- [ ] **Step 3: Create the page** (adapt the brainstorm mockup: web-console preview, 6 cards). Full file:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>테마 선택 — Email Blast</title>
<style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  *{box-sizing:border-box} body{margin:0;background:#f6f7fb;color:#1f2430}
  .wrap{max-width:1160px;margin:0 auto;padding:40px 28px 80px}
  h1{font-size:26px;margin:0 0 6px;letter-spacing:-.4px}
  .sub{margin:0 0 28px;color:#6b7280;font-size:15px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
  @media(max-width:920px){.grid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:620px){.grid{grid-template-columns:1fr}}
  .card{background:#fff;border:1.5px solid #e6e8ef;border-radius:16px;overflow:hidden;cursor:pointer;
    transition:transform .12s,box-shadow .12s,border-color .12s;display:flex;flex-direction:column}
  .card:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(20,24,40,.10)}
  .card.sel{border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 28%,transparent)}
  .console{height:176px;background:#eceef3;padding:12px}
  .win{height:100%;background:#fff;border:1px solid #e3e5ec;border-radius:9px;overflow:hidden;display:flex;flex-direction:column}
  .bar{height:18px;background:#f3f4f7;border-bottom:1px solid #eaebf0;display:flex;align-items:center;gap:5px;padding:0 8px}
  .bar i{width:7px;height:7px;border-radius:50%;background:#d4d6dd}
  .body{flex:1;display:flex;min-height:0}
  .rail{width:42px;background:var(--d);display:flex;flex-direction:column;align-items:center;padding-top:9px;gap:9px}
  .rail .lg{width:18px;height:18px;border-radius:6px;background:#fff}
  .rail .ic{width:18px;height:18px;border-radius:5px;background:rgba(255,255,255,.28)}
  .rail .ic.on{background:rgba(255,255,255,.95)}
  .main{flex:1;padding:11px 12px;min-width:0}
  .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}
  .word{height:9px;width:64px;border-radius:4px;background:var(--a)}
  .btn{font-size:8px;font-weight:700;color:#fff;padding:5px 10px;border-radius:6px;background:linear-gradient(135deg,var(--c),var(--a))}
  .tabs{display:flex;gap:12px;margin-bottom:10px}
  .tab{height:6px;width:34px;border-radius:3px;background:#dfe1e8}
  .tab.on{background:var(--a)}
  .rows .r{height:7px;border-radius:4px;background:#e7e8ee;margin-bottom:6px}
  .rows .r:nth-child(2){width:82%}.rows .r:nth-child(3){width:68%}
  .chips{display:flex;align-items:center;gap:7px;margin-top:10px}
  .badge{font-size:8px;font-weight:700;color:var(--a);background:var(--t);border:1px solid color-mix(in srgb,var(--a) 22%,#fff);padding:3px 7px;border-radius:999px}
  .stat{font-size:16px;font-weight:800;color:var(--a);margin-left:auto}
  .meta{padding:14px 16px 16px;border-top:1px solid #f0f1f4}
  .mtop{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
  .meta h3{margin:0;font-size:16px}
  .vibe{color:#8a8f9c;font-size:12.5px}
  .sw{display:flex;gap:6px}.sw div{width:22px;height:22px;border-radius:6px;border:1px solid rgba(0,0,0,.06)}
  .toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);background:#1f2430;color:#fff;
    padding:12px 18px;border-radius:10px;font-size:14px;opacity:0;transition:all .2s;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  .hint{margin-top:26px;font-size:13px;color:#9aa0ac;text-align:center}
</style>
</head>
<body>
  <div class="wrap">
    <h1>테마를 골라주세요</h1>
    <p class="sub">고른 색은 <b>웹 콘솔(앱) UI</b>에만 적용됩니다. 이메일 본문 디자인은 영향을 받지 않습니다.</p>
    <div class="grid" id="grid"></div>
    <div class="hint">카드를 클릭하면 선택됩니다. 선택 후 창을 꺼주세요.</div>
  </div>
  <div class="toast" id="toast"></div>
<script>
  /*__INIT_INJECT__*/
  const THEMES = window.__THEMES || [];
  const grid = document.getElementById("grid");
  const toast = document.getElementById("toast");
  THEMES.forEach((t) => {
    const el = document.createElement("div");
    el.className = "card";
    el.style.setProperty("--a", t.accent); el.style.setProperty("--c", t.cta);
    el.style.setProperty("--d", t.deep);   el.style.setProperty("--t", t.tint);
    el.innerHTML =
      '<div class="console"><div class="win"><div class="bar"><i></i><i></i><i></i></div>'+
      '<div class="body"><div class="rail"><div class="lg"></div><div class="ic on"></div><div class="ic"></div><div class="ic"></div></div>'+
      '<div class="main"><div class="top"><div class="word"></div><div class="btn">보내기</div></div>'+
      '<div class="tabs"><div class="tab on"></div><div class="tab"></div><div class="tab"></div></div>'+
      '<div class="rows"><div class="r"></div><div class="r"></div><div class="r"></div></div>'+
      '<div class="chips"><div class="badge">발송됨</div><div class="stat">128</div></div></div></div></div></div>'+
      '<div class="meta"><div class="mtop"><h3>'+t.name+'</h3><div class="sw">'+
      '<div style="background:'+t.accent+'"></div><div style="background:'+t.cta+'"></div><div style="background:'+t.deep+'"></div>'+
      '</div></div><div class="vibe">'+t.vibe+'</div></div>';
    el.addEventListener("click", () => select(t, el));
    grid.appendChild(el);
  });
  function select(t, el) {
    document.querySelectorAll(".card").forEach((c) => c.classList.remove("sel"));
    el.classList.add("sel");
    fetch("/select", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ theme: t.id, token: window.__TOKEN }) }).catch(() => {});
    toast.textContent = '"'+t.name+'" 선택됨 — 창을 꺼주세요';
    toast.classList.add("show");
  }
</script>
</body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/init/theme-picker.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/init/theme-picker.html scripts/init/theme-picker.test.mjs
git commit -m "feat(init): add reusable theme picker page"
```

---

### Task 7: 오케스트레이터 (`init.mjs`) + npm 스크립트

**Files:**
- Create: `scripts/init.mjs`
- Modify: `package.json` (scripts.init)

**Interfaces:**
- Consumes: `THEMES`/`getTheme`/`appTokensFor` (Task 1), `validate.mjs` (Task 2), `renderEnv` (Task 3), `renderConfig` (Task 5), 템플릿(Task 4), 팔레트 HTML(Task 6).
- Produces: 실행 가능한 `npm run init`.

이 작업은 대화형 I/O라 단위 테스트 대신 **수동 검증**으로 게이트한다.

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, add:
```json
"init": "node scripts/init.mjs"
```

- [ ] **Step 2: Write the orchestrator**

```js
// scripts/init.mjs
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
const exists = async (f) => { try { await access(f); return true; } catch { return false; } };

const rl = createInterface({ input: stdin, output: stdout });

async function ask(q, def) {
  const a = (await rl.question(def ? `${q} [${def}] ` : `${q} `)).trim();
  return a || def || "";
}
async function askValid(q, def, ok, err) {
  while (true) { const a = await ask(q, def); if (ok(a)) return a; console.log(`  ⚠ ${err}`); }
}
async function askMasked(q) {
  // minimal masking: mute echo while typing
  const r = createInterface({ input: stdin, output: stdout, terminal: true });
  const orig = stdout.write.bind(stdout);
  r._writeToOutput = () => orig("*");
  const a = (await r.question(`${q} `)).trim();
  r.close(); orig("\n");
  return a;
}
async function confirm(q, def = true) {
  const a = (await ask(`${q} (${def ? "Y/n" : "y/N"})`, "")).toLowerCase();
  if (!a) return def;
  return a.startsWith("y");
}
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref(); } catch {}
}

async function pickTheme() {
  const token = randomBytes(8).toString("hex");
  let html = await readFile(p("./init/theme-picker.html"), "utf8");
  const inject = `window.__THEMES=${JSON.stringify(THEMES)};window.__TOKEN=${JSON.stringify(token)};`;
  html = html.replace("/*__INIT_INJECT__*/", inject);

  return new Promise((resolve) => {
    let done = false;
    const finish = (id) => { if (done) return; done = true; try { server.close(); } catch {} resolve(id); };
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && u.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html); return;
      }
      if (req.method === "POST" && u.pathname === "/select") {
        let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
          try {
            const { theme, token: tk } = JSON.parse(b || "{}");
            if (tk !== token || !getTheme(theme)) { res.writeHead(403); res.end(); return; }
            res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
            finish(theme);
          } catch { res.writeHead(400); res.end(); }
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}/?token=${token}`;
      openBrowser(url);
      console.log(`\n  테마를 브라우저에서 고르세요: ${url}`);
      console.log(`  또는 번호 입력: ${THEMES.map((t, i) => `${i + 1}) ${t.name}`).join("   ")}`);
      rl.question("  > ").then((ans) => {
        const i = parseInt(ans.trim(), 10);
        if (i >= 1 && i <= THEMES.length) finish(THEMES[i - 1].id);
      }).catch(() => {});
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

async function main() {
  console.log("\n=== Email Blast 설정 (npm run init) ===\n");
  const brandFile = `${root}brand.config.ts`;
  const envFile = `${root}.env.local`;

  if ((await exists(brandFile)) || (await exists(envFile))) {
    if (!(await confirm("기존 설정이 있습니다. 백업하고 새로 만들까요?", true))) {
      console.log("취소했습니다."); rl.close(); return;
    }
  }

  const v = {};
  v.company = await ask("서비스/회사 이름?", "Acme");
  const mode = await ask("로그인 방식? (1) 비밀번호  (2) Google", "1");
  v.mode = mode === "2" ? "google" : "password";

  if (v.mode === "password") {
    v.accessPassword = await askMasked("접속 비밀번호?");
    v.operatorEmail = await askValid("운영자 이메일(=관리자)?", "", isEmail, "이메일 형식이 아닙니다.");
    v.operatorName = v.company;
  } else {
    v.loginDomain = await askValid("Google 로그인 허용 도메인?", "", isDomain, "도메인 형식이 아닙니다.");
    v.googleClientId = await ask("Google Client ID? (없으면 Enter)", "");
    v.googleClientSecret = await ask("Google Client Secret? (없으면 Enter)", "");
  }

  const themeId = await pickTheme();
  Object.assign(v, appTokensToValues(appTokensFor(themeId)));
  console.log(`  테마: ${getTheme(themeId).name}\n`);

  if (await confirm("지금 발송도 설정할까요?", false)) {
    v.senderDomain = await askValid(
      "발송 도메인 (Resend 인증된 도메인)?",
      suggestSenderDomain(v.operatorEmail || ""), isDomain, "도메인 형식이 아닙니다."
    );
    v.resendKey = await ask("Resend API 키? (없으면 Enter — 발송 전 도메인 인증 필요)", "");
    v.replyTo = await ask("답장 받을 주소?", "");
    v.legalName = await ask("법인명(컴플라이언스)?", `${v.company} Inc.`);
    v.postalAddress = await ask("우편주소(CAN-SPAM)?", "");
    v.contactEmail = await ask("문의 이메일?", "");
  }

  const template = await readFile(p("./init/brand.config.template.ts"), "utf8");
  const sessionSecret = (await preserveSessionSecret(envFile)) || randomBytes(32).toString("base64url");

  console.log("\n--- 요약 ---");
  console.log(`  회사: ${v.company} | 로그인: ${v.mode} | 테마: ${getTheme(themeId).name}` +
    (v.senderDomain ? ` | 발송: ${v.senderDomain}` : " | 발송: 나중에"));
  if (!(await confirm("이대로 작성할까요?", true))) { console.log("취소했습니다."); rl.close(); return; }

  await backupIfExists(brandFile);
  await backupIfExists(envFile);
  await writeFile(brandFile, renderConfig(template, v));
  await writeFile(envFile, renderEnv(v, sessionSecret));

  console.log("\n✓ 설정 완료!");
  console.log("  다음 단계 → 배포: docs/production.md");
  console.log("  (수정/미리보기: npm run dev → http://localhost:3001)\n");
  rl.close();
}

function appTokensToValues(t) {
  return { appAccent: t.APP_ACCENT, appAccentBright: t.APP_ACCENT_BRIGHT, appAccentDeep: t.APP_ACCENT_DEEP };
}

main().catch((e) => { console.error(e); rl.close(); process.exit(1); });
```

- [ ] **Step 3: Manual verification — password mode, theme via terminal**

Run (in a scratch copy or after backing up your dev files):
```bash
npm run init
```
Answer: company `TestCo`, login `1`, password `pw`, email `me@testco.com`, theme `2` (terminal number), sending `n`, confirm `y`.
Expected: `brand.config.ts` contains `const COMPANY = "TestCo";`, `const AUTH_MODE = "password";`, `const APP_ACCENT = "#2563eb";` (Ocean), and `const EMAIL_PRIMARY = "#5b5bf0";` unchanged. `.env.local` has `ACCESS_PASSWORD=pw` and an `AUTH_SESSION_SECRET=`.

Verify:
```bash
grep -E 'COMPANY|AUTH_MODE|APP_ACCENT |EMAIL_PRIMARY' brand.config.ts
grep -E 'ACCESS_PASSWORD|AUTH_SESSION_SECRET' .env.local
```

- [ ] **Step 4: Manual verification — boots**

Run:
```bash
npm run build  # or: npm run dev, then curl
```
Expected: build succeeds (config type-checks); `npm run dev` → `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/login` returns `200`.

- [ ] **Step 5: Manual verification — browser theme + backup**

Run `npm run init` again; this time click a theme card in the opened browser (don't type a number).
Expected: wizard proceeds after the click; existing `brand.config.ts`/`.env.local` get `.bak.<stamp>` copies; `AUTH_SESSION_SECRET` is preserved (same value as before).

- [ ] **Step 6: Commit**

```bash
git add scripts/init.mjs package.json
git commit -m "feat(init): add interactive wizard orchestrator and npm run init"
```

---

### Task 8: 문서 갱신 + 정리

**Files:**
- Modify: `.gitignore` (line ~9 comment), `docs/setup.md`, `docs/white-label.md`

- [ ] **Step 1: Update `.gitignore` setup comment**

Replace the comment block referencing `cp brand.config.example.ts brand.config.ts` with:
```
# brand.config.ts is generated per-deploy by `npm run init` (template: scripts/init/brand.config.template.ts).
brand.config.ts
```

- [ ] **Step 2: Update docs entry point**

In `docs/setup.md` and `docs/white-label.md`, replace any `cp brand.config.example.ts brand.config.ts` + hand-edit instructions with:
```
첫 설정: `npm run init` (대화형 위저드가 brand.config.ts + .env.local 생성)
고급 개인화: 생성된 brand.config.ts를 직접 수정
```

- [ ] **Step 3: Verify no stale references remain**

Run:
```bash
grep -rn "brand.config.example" . --include="*.ts" --include="*.md" --include="*.json" | grep -v node_modules
```
Expected: no results (all references removed/updated).

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS — all existing lib tests + new `scripts/init/*.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add .gitignore docs/setup.md docs/white-label.md
git commit -m "docs(init): switch setup entry point to npm run init"
```

---

## Self-Review

- **Spec coverage:** 위저드 플로우(Task 7) · 아키텍처/파일구성(Task 1–7) · 테마 프리셋(Task 1,6) · 콜백 서버+터미널 fallback(Task 7) · 디코플링(Task 4) · 안전장치 백업/마스킹/시크릿 보존(Task 7) · 의존성 0개(Global) · 문서 갱신·example 삭제(Task 4,8) — 모두 매핑됨.
- **Placeholder scan:** 모든 코드/테스트/명령 구체화됨. "적절한 에러처리" 류 없음.
- **Type consistency:** `appTokensFor` 반환 키(`APP_ACCENT/BRIGHT/DEEP`) → `appTokensToValues` → `renderConfig` map 키 일치. `renderEnv(values, sessionSecret)` 시그니처 Task 3·7 일치. `/*__INIT_INJECT__*/` 플레이스홀더 Task 6·7 일치.

## 참고 — 범위 밖 (별도 처리)
- `lib/templates.ts` 견고화(폴더 없어도 안 터지게)는 이 플랜 밖. 현재 폴더 생성으로 우회 중 — 별도 작은 작업으로 처리 권장.
