# 설계 스펙 — Init 위저드 + 테마 프리셋

- **작성일**: 2026-06-26
- **범위(sub-project A)**: 대화형 init 위저드 + 테마 프리셋 시스템
- **범위 밖**: 앱 내 설정 화면/온보딩 UI(B), 핵심 발송 UX·블록 템플릿 개편(C) — 별도 스펙

---

## 1. 목적

이 도구를 처음 설치한 사람이 가이드 문서를 읽지 않고도 `npm run init` 한 번으로
`brand.config.ts` + `.env.local`을 채워 **부팅 가능한 상태**로 만들 수 있게 한다.
색 테마는 터미널이 아니라 **브라우저 팔레트 페이지에서 시각적으로** 고른다.

## 2. 핵심 결정 (확정)

1. **init은 항상 실행된다고 전제.** 손편집(`cp` 후 수정)은 설계에서 제외. 손편집은 *init 이후 고급 개인화* 용도로만 남는다.
2. **brand.config.ts는 init이 생성하는 산출물.** 앱 27개 파일이 import하므로 반드시 존재해야 하지만, 사람이 만지는 시작점은 아니다.
3. **brand.config.example.ts는 init 소유 템플릿으로 이동** → `scripts/init/brand.config.template.ts`. 루트에서 제거(혼란 방지).
4. **테마 = 웹 콘솔(앱) UI 색 전용.** 이메일 본문 색은 건드리지 않는다.
5. **아키텍처는 웹 유지 + 실제 배포.** 데스크톱 앱 전환 안 함 (수신거부 공개 링크·팀 공유 상태가 데스크톱에서 깨짐). 이 앱은 정적 사이트가 아니므로 GitHub/Cloudflare Pages 배포 불가 — 상주 Node 서버 + 영구 디스크 필요.
6. **의존성 0개.** Node 내장 모듈만 사용 → `npm install` 추가 불필요.

## 3. 위저드 플로우 (`npm run init`)

### 사전 점검
- `brand.config.ts` / `.env.local`이 이미 있으면 → 타임스탬프 백업(`*.bak.<시각>`) 후 진행, 확인 프롬프트. 무단 덮어쓰기 금지.

### 1단계 — 기본 (항상)
| # | 질문 | 채우는 곳 | 비고 |
|---|---|---|---|
| 1 | 서비스/회사 이름 | `COMPANY` | `appTitle`·`defaultSubject` 등 자동 파생 |
| 2 | 로그인 방식 (1)비밀번호 (2)Google | `auth.mode` | 분기 |
| 2a | (비번) 접속 비밀번호 | `.env ACCESS_PASSWORD` | 입력 마스킹 |
| 2b | (비번) 운영자 이메일 | `auth.operatorEmail` | 형식 검증, =자동 admin |
| 2c | (Google) 허용 도메인 / Client ID·Secret | `auth.loginDomain` / `.env` | 키 없으면 Enter=나중에 |
| 3 | **테마 선택** | `APP_ACCENT` 계열 3색 | 브라우저 팔레트 → 클릭 → 콜백 |
| — | `AUTH_SESSION_SECRET` | `.env` | 자동 생성(안 물음). 재실행 시 기존값 보존 |

### 2단계 — 발송도 세팅? (y/N 게이트)
- **yes**: 발송 도메인 `senderDomain`(→ `builtinFrom` 파생) · Resend API 키(Enter=나중에 + 도메인 인증 안내) · 답장 주소 `replyToDefault` · 컴플라이언스(법인명/우편주소/문의 이메일)
- **no**: 기본값/placeholder 유지 + "나중에 `npm run init` 재실행" 안내

### 마무리
- 입력 요약 표 → 최종 확인(y) → 파일 작성
- 다음 단계 안내:
  ```
  ✓ 설정 완료!  다음 단계 → 배포: docs/production.md 참고
  (수정/미리보기: npm run dev → localhost:3001)
  ```

## 4. 아키텍처

### 파일 구성
```
scripts/
  init.mjs                      # 진입점 (package.json "init": "node scripts/init.mjs")
  init/
    themes.mjs                  # ★ 6개 프리셋 단일 출처 (id·name·vibe·accent·cta·deep·tint)
    theme-picker.html           # 재사용 팔레트 페이지 (POST /select)
    brand.config.template.ts    # 구 brand.config.example.ts 이동 + 디코플링 반영
```
- `package.json` scripts에 `"init": "node scripts/init.mjs"` 추가.
- 루트 `brand.config.example.ts` 제거.

### brand.config.ts 생성 방식
init이 `brand.config.template.ts`를 읽어 **상단 상수만 치환**(수집값 + 프리셋 3색),
나머지 구조·주석·파생식은 그대로 두고 `brand.config.ts`로 작성.
치환 지점은 `/* @init */` 주석 마커 + 명시적 상수명(`const COMPANY = "..."`)으로 식별.

### 테마 콜백 (브라우저 ↔ 위저드)
1. init이 `127.0.0.1:<랜덤포트>`에 http 서버 기동 (URL에 1회용 토큰).
2. `themes.mjs`를 읽어 `theme-picker.html`에 `<script>window.__THEMES=…</script>` 주입 후 서빙.
3. 브라우저 자동 오픈 (mac `open` / linux `xdg-open` / win `start`).
4. 라우트: `GET /` → 팔레트 페이지, `POST /select` → `{theme}` 수신 + 토큰 검증 → 페이지에 "선택됨·창 꺼주세요".
5. 위저드는 콜백 await **와 동시에** 터미널 번호(1–6) 입력을 race → 먼저 오는 것 채택(헤드리스/SSH 대비).
6. 선택 시 서버 종료.

### .env.local 작성
- 수집 시크릿을 `KEY=value`로 생성.
- `AUTH_SESSION_SECRET = crypto.randomBytes(32).toString('base64url')` 자동, 재실행 시 기존값 보존.

### 안전장치
- 기존 파일 타임스탬프 백업 후 진행.
- 입력 검증: 이메일·도메인 정규식, 필수값 빈값 재입력.
- 비밀번호 입력 마스킹.
- URL 1회용 토큰으로 다른 로컬 프로세스의 콜백 차단.

## 5. 테마 프리셋 시스템

- **프리셋 6개** (단일 출처 `themes.mjs`):
  | id | 이름 | 무드 | accent / cta / deep |
  |---|---|---|---|
  | indigo | Indigo | 테크·SaaS 기본(기본값) | #5b5bf0 / #7c7cff / #4a4ad6 |
  | ocean | Ocean | 신뢰·기업·클래식 | #2563eb / #3b82f6 / #1d4ed8 |
  | emerald | Emerald | 성장·친환경·헬스 | #0f9d6e / #14b886 / #0a7d57 |
  | crimson | Crimson | 이벤트·강렬·리테일 | #e11d48 / #f43f5e / #be123c |
  | amber | Amber | 따뜻함·F&B·캠페인 | #d97706 / #f59e0b / #b45309 |
  | graphite | Graphite | 미니멀·모노·프리미엄 | #111827 / #374151 / #0b1220 |
- **팔레트 페이지**: 각 카드가 미니 웹 콘솔(좌측 레일·"보내기" 버튼·활성 탭·뱃지·통계)을 프리셋 색으로 렌더 → "이게 앱 색"임을 직관적으로 전달. 이메일 미리보기는 의도적으로 제외.
- **재사용**: 같은 `theme-picker.html`을 브레인스토밍과 실제 init 양쪽에서 사용. `/select` POST는 init 모드에서만 동작(컴패니언 모드에선 무시), `window.toggleSelect` 폴백으로 이벤트 기록.
- `themes.mjs`를 HTML과 위저드가 공유 → 팔레트 값 드리프트 없음.

## 6. 테마 디코플링 리팩토링 (init 템플릿 내)

대상: `scripts/init/brand.config.template.ts`

**Before** — 한 상수가 메일+앱 동시 구동:
```ts
const PRIMARY      = "#5b5bf0";  // email teal + ui.appAccent
const PRIMARY_CTA  = "#7c7cff";  // email mint + ui.appAccentBright
const PRIMARY_DEEP = "#4a4ad6";  // ui.appAccentDeep
```
**After** — 분리:
```ts
/* ── 앱 테마 (★ npm run init 이 프리셋으로 덮어씀) ── @init:theme */
const APP_ACCENT        = "#5b5bf0";  // → ui.appAccent       (--brand / --ring)
const APP_ACCENT_BRIGHT = "#7c7cff";  // → ui.appAccentBright  (--brand-mint)
const APP_ACCENT_DEEP   = "#4a4ad6";  // → ui.appAccentDeep    (--brand-deep / --rail)

/* ── 이메일 색 (init 안 건드림, 기본값 고정) ── */
const EMAIL_PRIMARY     = "#5b5bf0";  // → email.colors.teal
const EMAIL_PRIMARY_CTA = "#7c7cff";  // → email.colors.mint
const EMAIL_TINT_BG     = "#eef0ff";
const EMAIL_TINT_BORDER = "#dce0ff";
```
- `ui.appAccent* → APP_*`, `email.colors.* → EMAIL_*`로 연결 변경.
- 중립색·텍스트색(TEXT_HEADING/BODY/HAIRLINE…)은 brand 액센트가 아니므로 그대로 공유 유지.
- 결과: 테마 선택은 `@init:theme` 블록 3색만 교체 → 이메일은 항상 기본(Indigo). 메일도 맞추려면 `EMAIL_*` 직접 수정(문서 1줄 안내).
- 프리셋 `{accent, cta, deep}` → `APP_ACCENT / BRIGHT / DEEP` 1:1 매핑.

## 7. 변경/생성/삭제 파일

**생성**
- `scripts/init.mjs`
- `scripts/init/themes.mjs`
- `scripts/init/theme-picker.html`
- `scripts/init/brand.config.template.ts` (example 이동 + 디코플링)

**수정**
- `package.json` — `scripts.init` 추가
- `docs/setup.md` / `docs/white-label.md` — "cp 후 수정" → "`npm run init`" 진입점으로 갱신 (1줄 수준)
- `.gitignore` — 필요 시 `.superpowers/` 추가(브레인스토밍 산출물)

**삭제**
- 루트 `brand.config.example.ts` (→ `scripts/init/brand.config.template.ts`로 이동)

## 8. 성공 기준

- 깨끗한 clone에서 `npm install && npm run init` → 질문 응답 → `npm run dev`로 부팅 성공.
- 테마 단계에서 브라우저 클릭으로 고른 색이 앱 콘솔(`--brand` 등)에 반영, 이메일 색은 불변.
- Resend 키 없이도 "발송 나중에"로 진행해 UI 부팅 가능.
- 기존 `brand.config.ts`/`.env.local`가 있을 때 무단 덮어쓰기 없이 백업 후 진행.
- 헤드리스 환경에서 브라우저 없이 터미널 번호 입력으로 테마 선택 가능.

## 9. 미해결/후속

- 비개발자 배포 간소화(Docker `compose up` / PM2 스크립트) — 별도 과제.
- 앱 내 설정 화면(B)·핵심 UX(C) — 별도 스펙.
