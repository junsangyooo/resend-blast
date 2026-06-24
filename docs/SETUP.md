# SETUP — 처음 시작하기

이 repo를 가져다 **본인(회사/개인) 브랜드의 메일 발송 툴**로 띄우는 전체 절차다.
바꾸는 파일은 단 두 개: **`brand.config.ts`(공개 브랜드)** 와 **`.env.local`(비밀 키)**.

```
brand.config.ts   ← 회사명·도메인·색·로고·인증방식  (공개돼도 되는 값)
.env.local        ← API 키·비밀번호·시크릿            (절대 커밋 금지)
```

> 왜 두 개인가? `brand.config.ts`는 화면 렌더에 쓰여 **브라우저로 전송**된다(공개). 그래서
> 비밀 키는 절대 여기 두면 안 되고 `.env.local`로 분리한다. 이건 보안 원칙이라 합칠 수 없다.

---

## 0. 사전 준비물

| 필요한 것 | 용도 | 없어도 되나 |
|---|---|---|
| **도메인 1개** | 발신 주소(`hello@send.yourbrand.com`) | ❌ 필수 (gmail.com 등으론 발송 인증 불가) |
| **Resend 계정** | 이메일 발송 | ❌ 필수 |
| Node.js ≥ 18.17 | 실행 | ❌ 필수 |
| 이미지 저장소(Azure/R2/S3) | 메일에 이미지 업로드 | ⬜ 이미지 안 쓰면 생략 가능 |
| Google Cloud 프로젝트 | Google 로그인 모드 | ⬜ 비밀번호 모드면 불필요 |

---

## 1. 클론 & 설치

```bash
git clone <your-repo-url> && cd email-blast
npm install
cp brand.config.example.ts brand.config.ts
cp .env.local.example .env.local
```

`brand.config.ts`와 `.env.local`은 **gitignore** 되어 커밋되지 않는다(본인 전용).

---

## 2. `brand.config.ts` 채우기 (브랜드·디자인)

파일 맨 위 **기준값 6개 + 디자인 토큰**만 바꾸면 대부분 전파된다.

```ts
const COMPANY = "Acme";                       // 회사/서비스 이름
const LEGAL_NAME = "Acme Inc.";               // 컴플라이언스 푸터 전송자명
const LOGIN_DOMAIN = "acme.com";              // Google 로그인 허용 도메인 (google 모드만)
const SENDER_DOMAIN = "send.acme.com";        // 발신 도메인 (★Resend 인증과 일치해야 함)
const WEBSITE_URL = "https://www.acme.com";   // 푸터 로고 클릭 링크
const ASSET_BASE = "https://cdn.acme.com/assets"; // 로고·아이콘 공개 URL 베이스
```

**디자인 색상** (이메일 + 앱 콘솔이 같은 팔레트를 공유):

```ts
const PRIMARY     = "#5b5bf0";  // 강조색 (링크·버튼·포인트·앱 액센트)
const PRIMARY_CTA = "#7c7cff";  // CTA 버튼
const PRIMARY_DEEP= "#4a4ad6";  // 진한 강조 (앱 레일)
// ... TEXT_*, TINT_*, EMAIL_* 등도 의미 단위로 분리돼 있다
```

그 외 섹션:

| 섹션 | 무엇 |
|---|---|
| `senders.builtinFrom` | 발신자 목록 (최소 1개, senderDomain 과 일치) |
| `senders.replyToDefault` | 기본 회신 주소 (senderDomain 밖, 예: 본인 gmail 도 가능) |
| `email.headerLogo` / `footerLogo` / `socialIcons` / `social` | 로고·소셜 (링크 비우면 아이콘 자동 숨김) |
| `assets.provider` | 이미지 저장 백엔드 (`"azure"` 등 — 4절) |

---

## 3. 인증 방식 선택 — `auth.mode`

`brand.config.ts` 의 `auth` 섹션에서 **한 줄**로 결정한다.

### (A) 비밀번호 모드 — 가장 빠른 시작 (외부 의존성 0)

```ts
auth: {
  mode: "password",
  operatorEmail: "you@gmail.com",  // 단일 운영자 = 자동 관리자 (세션·발신자 소유에 사용)
  ...
}
```
그리고 `.env.local` 에:
```
ACCESS_PASSWORD=원하는_비밀번호
```
→ 첫 진입 시 비밀번호 입력 화면. 맞으면 `operatorEmail` 신원으로 로그인된다.
구글 설정이 전혀 필요 없다.

### (B) Google 모드 — Workspace 도메인 로그인

```ts
auth: { mode: "google", loginDomain: "acme.com", ... }
```
`.env.local` 에 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 필요 (발급법은 5-4절).

> 전환은 `mode` 한 줄만 바꾸면 끝. 두 방식 코드가 모두 들어있다.

---

## 4. 이미지 — 저장 백엔드 + 전달 방식

이미지는 **2개 축**으로 설정한다 (`brand.config.ts` 의 `assets`).

### 4-1. 저장 백엔드 `assets.provider` — 어디에 저장하나

**기본: `"local"`** — 외부 계정 0개. 업로드 이미지를 서버 디스크(`data/uploads/`)에 저장.
별도 설정 불필요.

**대안: `"azure"`** (오브젝트 스토리지)
```
AZURE_STORAGE_ACCOUNT=
AZURE_STORAGE_KEY=          # az storage account keys list -n <account>
AZURE_STORAGE_CONTAINER=
```
**Cloudflare R2 / AWS S3** 등은 어댑터(`lib/storage/adapters/<name>.ts`)를 추가하고
`lib/storage/index.ts` 의 `ADAPTERS` 에 등록(상세: `docs/WHITELABEL.md` 3-1절).

### 4-2. 전달 방식 `assets.delivery` — 메일에 어떻게 싣나

**기본: `"attach"`** — 발송 시 로컬 이미지를 **메일에 CID 인라인 첨부**(`<img src="cid:…">`).
→ 외부 호스팅·공개 URL **불필요**. 개인·소수 발송에 최적.
한도: 메일 1통당 base64 후 40MB. *주의: 수신자마다 이미지가 재전송되므로 대량 발송엔 비효율.*

**`"hosted"`** — 이미지 URL 을 그대로 참조(메일 클라이언트가 외부에서 로드). 대량에 효율적.
단 앱(local 서빙) 또는 스토리지가 **공개 도메인**으로 떠 있어야 한다.

> 외부 CDN URL(예: 브랜드 로고)은 attach 모드에서도 그대로 hosted 로 남는다(로컬 업로드만 첨부).

---

## 5. `.env.local` 채우기 (비밀 키) — 어디서 발급하나

### 5-1. 발송 키 (필수) — Resend
1. [resend.com](https://resend.com) 가입 → 좌측 **API Keys** → **Create API Key**
2. 권한 **Full access** 로 생성 → 키 복사
3. `.env.local`:
   ```
   RESEND_EMAIL_TRACKING_API_KEY=re_xxx
   ```

### 5-2. 세션 시크릿 (필수)
JWT 세션 서명용. 터미널에서 생성:
```bash
openssl rand -base64 32
```
```
AUTH_SESSION_SECRET=<위 출력값>
```

### 5-3. 비밀번호 (비밀번호 모드일 때)
```
ACCESS_PASSWORD=원하는_비밀번호
```

### 5-4. Google OAuth (Google 모드일 때)
1. [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 생성/선택
2. **API 및 서비스 → OAuth 동의 화면** 설정 (Internal 권장)
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 웹 애플리케이션**
4. **승인된 리디렉션 URI** 에 추가:
   - `http://localhost:3001/api/auth/google/callback`
   - `https://<배포도메인>/api/auth/google/callback`
5. 생성된 ID/시크릿:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

### 5-5. 선택 변수
```
ADMIN_EMAILS=a@x.com,b@x.com   # 추가 관리자 (쉼표구분)
APP_BASE_URL=https://...       # 수신거부 링크 베이스 (배포 도메인)
SENDER_ORG_NAME=               # 컴플라이언스 전송자명 (기본 = brand.config legalName)
SENDER_POSTAL_ADDRESS=         # ⚠️ 외부 발송 시 법적 의무 (물리주소)
SENDER_CONTACT_EMAIL=          # 수신거부 mailto
RESEND_WEBHOOK_SECRET=         # Resend 웹훅 서명검증 (쓸 때만)
```

---

## 6. 발송 도메인 인증 (★전달성의 핵심 — 안 하면 스팸/거부)

1. [Resend](https://resend.com) → **Domains → Add Domain** → 본인 발신 도메인 입력
   (서브도메인 권장: `send.yourbrand.com` — 루트 도메인 평판 보호)
2. Resend가 주는 **SPF · DKIM (· DMARC)** DNS 레코드를 도메인 DNS에 등록
   (Cloudflare 등 도메인 관리 콘솔의 DNS 메뉴)
3. Resend에서 **Verified** 확인
4. `brand.config.ts` 의 `SENDER_DOMAIN` · `builtinFrom` 이 이 도메인과 일치하는지 확인

### (선택) 답장 받기
발신 도메인은 발송 전용이다. 답장을 받으려면 **수신 라우팅**을 따로 둔다:
- 예) **Cloudflare Email Routing**(무료): `inquiry@yourbrand.com` → 본인 받은편지함으로 포워딩
- `brand.config` 의 `replyToDefault` 를 그 주소로 설정

---

## 7. 첫 실행 & 확인

```bash
npm run dev      # http://localhost:3001
```
- 로그인 화면(비밀번호 또는 Google)이 뜨면 인증 설정 정상
- 리스트 만들기 → 템플릿(이메일) 만들기 → 본인에게 테스트 발송
- `npm test` 통과 확인

---

## 8. 배포 (개요)

이 앱은 일반 Next.js 앱이다. 어디든 배포 가능:
- **Node 서버**(VM/클라우드 인스턴스) + 리버스 프록시(Caddy/Nginx, 자동 HTTPS)
- 또는 컨테이너/PaaS

핵심 체크:
1. 배포 서버에 `.env.local`(또는 환경변수)과 `brand.config.ts` 를 둔다(둘 다 gitignore라 별도 전송)
2. `npm run build && npm start`
3. 배포 도메인 → 서버로 DNS A 레코드, HTTPS 인증서 발급
4. Google 모드면 OAuth 리디렉션 URI에 배포 도메인 추가(5-4)
5. 6절 발송 도메인 인증 완료

---

## 9. 셋업 체크리스트

- [ ] `npm install`
- [ ] `cp brand.config.example.ts brand.config.ts` → 기준값·디자인 토큰 교체
- [ ] `cp .env.local.example .env.local`
- [ ] `auth.mode` 선택 (password → `ACCESS_PASSWORD`, google → `GOOGLE_CLIENT_*`)
- [ ] `RESEND_EMAIL_TRACKING_API_KEY` (5-1)
- [ ] `AUTH_SESSION_SECRET` (5-2)
- [ ] (이미지 쓰면) 스토리지 provider + 키 (4절)
- [ ] **발송 도메인 SPF/DKIM 인증** (6절) ← 안 하면 메일이 스팸/거부
- [ ] `SENDER_POSTAL_ADDRESS` (외부 발송 시 법적 의무)
- [ ] `npm test` → `npm run build` → 배포
