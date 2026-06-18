# WHITELABEL — 다른 회사·개인용으로 옮기기

이 프로젝트는 **화이트라벨(white-label)** 구조다. 회사 종속 값(브랜드·도메인·로고·색상)은
모두 한 곳(`brand.config.ts`)에 모여 있고, 비밀(API 키)은 `.env.local`에만 있다.
**이 두 가지만 바꾸면** 어느 회사/개인용으로든 동일하게 작동한다.

> 검증됨: `brand.config.ts`의 도메인·회사명·색상을 가짜 값(acme.io)으로 바꿔도
> 타입체크와 전체 테스트(45개)가 그대로 통과한다. 코드 본문에는 RLWRLD 하드코딩이 없다.

---

## 0. 핵심 원칙 — 무엇이 어디에 있나

| 성격 | 위치 | 예 | Git |
|---|---|---|---|
| **비밀(secret)** | `.env.local` | API 키·토큰·세션 시크릿 | 커밋 안 함(`.gitignore`) |
| **브랜드(공개 정체성)** | `brand.config.ts` | 회사명·도메인·로고 URL·색상·UI 문구 | 커밋함(아래 "Git 운용" 참고) |
| **운영 데이터** | `data/`, `templates/` | 리스트·발송로그·템플릿 | 화이트리스트 백업 |

⚠️ **`brand.config.ts`에는 절대 비밀을 넣지 말 것.** 이 파일은 클라이언트 번들에
포함될 수 있다(공개돼도 되는 값만). 키는 전부 `.env.local`.

---

## 1. `.env.local` — 키 발급 (비밀)

`~/.claude/secrets/.env` 또는 프로젝트 루트 `.env.local`에 채운다. 이름만 쓰고 값은 각자 발급.

| 변수 | 필수 | 용도 | 발급처 |
|---|:---:|---|---|
| `RESEND_RLWRLD_API_KEY` | ✅ | 발송용 키 | [resend.com](https://resend.com) → API Keys → Create |
| `RESEND_EMAIL_TRACKING_API_KEY` | ✅ | 트래킹/트랜잭션 발송(full access) | 같은 곳, full access 권한으로 |
| `AZURE_STORAGE_ACCOUNT` | ✅ | 이미지 업로드 계정명 | Azure Portal → Storage account |
| `AZURE_STORAGE_KEY` | ✅ | 위 계정 access key | `az storage account keys list -n <account>` |
| `AZURE_STORAGE_CONTAINER` | ⬜ | 컨테이너명(기본 `rldx-1-launch`) | Azure → Containers |
| `GOOGLE_CLIENT_ID` | ✅ | OAuth 클라이언트 | Google Cloud Console → 사용자 인증 정보 |
| `GOOGLE_CLIENT_SECRET` | ✅ | OAuth 시크릿 | 같은 곳 |
| `AUTH_SESSION_SECRET` | ✅ | 세션 JWT 서명(= `JWT_SECRET`) | `openssl rand -base64 32` 로 생성 |
| `ADMIN_EMAILS` | ⬜ | 관리자 이메일(쉼표구분). 남의 리스트·템플릿·발신자 관리 권한 | 직접 지정 |
| `APP_BASE_URL` | ⬜ | 앱 공개 URL(수신거부 링크 베이스). 기본은 `brand.config`의 `appBaseUrl` | 배포 도메인 |
| `SENDER_ORG_NAME` | ⬜ | 컴플라이언스 전송자 명칭. 기본은 `brand.config`의 `legalName` | — |
| `SENDER_POSTAL_ADDRESS` | ⚠️ | 발신자 물리 주소(CAN-SPAM 의무). 비면 푸터에서 생략 | **외부 발송 전 필수** |
| `SENDER_CONTACT_EMAIL` | ⬜ | 수신거부 mailto 주소. 기본은 `brand.config`의 `contactEmail` | — |
| `RESEND_WEBHOOK_SECRET` | ⬜ | Resend webhook 서명 검증 | Resend → Webhooks |

> **참고:** 예전엔 로그인 도메인을 `ALLOWED_DOMAIN` env로 설정했지만, 지금은
> `brand.config.ts`의 `auth.loginDomain`(순수 상수)으로 옮겼다. UI(클라이언트)가
> 이 값을 렌더하므로 env 의존 시 hydration 불일치가 나기 때문. **로그인 도메인은
> `brand.config.ts`에서 바꾼다.**

---

## 2. `brand.config.ts` — 브랜드 (이 파일 하나가 핵심)

파일 맨 위 **파생 기준값** 6개만 바꾸면 대부분 자동 전파된다:

```ts
const COMPANY = "RLWRLD";          // → 헤더·로그인·푸터·프리셋의 회사명
const LEGAL_NAME = "RLWRLD Inc.";  // → 컴플라이언스 푸터 전송자 명칭
const LOGIN_DOMAIN = "rlwrld.ai";  // → 로그인 허용 Google Workspace 도메인
const SENDER_DOMAIN = "rlwrld.ai"; // → From/Reply-To 허용 도메인 (★발송 차단의 핵심)
const WEBSITE_URL = "https://www.rlwrld.ai";        // → 이메일 푸터 로고 링크
const ASSET_BASE = "https://.../assets";            // → 로고·아이콘 호스팅 베이스
```

그 다음 섹션별로 세부 조정:

| 섹션 | 무엇 | 바꿀 때 |
|---|---|---|
| `identity` | 회사명·앱 제목·홈페이지·앱 베이스 URL | 회사 바뀌면 |
| `auth.loginDomain` | 로그인 허용 도메인 | **반드시** (안 바꾸면 본인 회사 계정 로그인 불가) |
| `auth.senderDomain` | 발신 허용 도메인 | **반드시** (안 바꾸면 본인 도메인 발송 차단) |
| `senders.builtinFrom` | 기본 발신자 목록 | 본인 발신 주소로 |
| `senders.replyToDefault` | 기본 회신 주소 | 본인 주소로 |
| `email.colors` | 이메일 본문 색(teal/mint 등) | 브랜드 색으로 |
| `email.headerLogo` / `footerLogo` | 이메일 상·하단 로고 | 본인 로고 URL로 (→ 3절) |
| `email.socialIcons` / `social` | 푸터 소셜 아이콘·링크 | 본인 SNS로. **링크를 빈 문자열로 두면 해당 아이콘 자동 숨김** |
| `logos` | 헤더 로고 선택 목록 | 본인 로고들로 |
| `templates.defaultSubject` | 새 템플릿 기본 제목 | — |
| `ui` | 로그인·헤더 문구 | 회사명 기반 자동 생성됨(보통 수정 불필요) |

---

## 3. 로고·아이콘 교체 (에셋)

이메일에 박히는 이미지는 **공개 URL**이어야 한다(메일 클라이언트가 외부에서 로드).

1. 로고 PNG(헤더용·푸터용)와 소셜 아이콘(X/LinkedIn/YouTube) 준비
2. Azure Blob(또는 임의 CDN/S3)에 업로드 → 공개 URL 확보
   - Azure 예: 앱의 이미지 업로드 기능(`/api/upload`)을 쓰거나 `az storage blob upload`
3. `brand.config.ts`의 `ASSET_BASE` + `email.headerLogo.url` / `footerLogo.url` /
   `socialIcons.*` / `logos[].url`을 새 URL로 교체
4. 로고 가로 비율이 다르면 `width`(헤더), `width`/`height`(푸터)도 조정

### 3-1. 스토리지 백엔드 교체 (Azure → S3 / R2 / 로컬 …)

앱은 운영 중 이미지를 업로드한다(블록 에디터 이미지, 커스텀 헤더 로고).
**어디에 업로드할지**는 스토리지 어댑터로 추상화돼 있다. 코드 본문은 어느 백엔드든
모르고, 진입점(`lib/storage/`)만 안다.

```
lib/storage/
  types.ts              StorageAdapter 인터페이스 (put() 하나)
  image-validation.ts   provider 무관 공통 검증 (magic-bytes·허용형식·5MB)
  index.ts              ★진입점. brand.config.assets.provider 로 어댑터 선택
  adapters/
    azure.ts            Azure Blob 어댑터 (기본)
```

**무엇이 어디에 있나 (자산 스토리지)**

| 성격 | 위치 | 예 |
|---|---|---|
| **어느 백엔드를 쓰나** | `brand.config.ts` → `assets.provider` | `"azure"` |
| **자격증명(키)** | `.env.local` | `AZURE_STORAGE_ACCOUNT` / `_KEY` / `_CONTAINER` |
| **어댑터 구현** | `lib/storage/adapters/<name>.ts` | 업로드 로직 |

**Azure 그대로 쓸 때 (기본)** — 아무것도 안 바꿔도 된다. `assets.provider: "azure"` +
`.env.local`의 `AZURE_STORAGE_*` 세 값이면 끝. (1절 표 참고.)

**다른 스토리지로 바꿀 때 — 4단계**

1. **어댑터 작성**: `lib/storage/adapters/<name>.ts` 에 `StorageAdapter` 구현.
   `put(data, contentType, ext)` 가 버퍼를 저장하고 **공개 URL**을 반환하면 된다.
   키는 어댑터 안에서 `process.env`로 직접 읽는다(brand.config 에 넣지 말 것).

   ```ts
   // 예: Cloudflare R2 / AWS S3 (S3 호환 SDK)
   import type { StorageAdapter } from "../types";
   export class R2Adapter implements StorageAdapter {
     readonly name = "r2";
     async put(data: Buffer, contentType: string, ext: string): Promise<string> {
       const bucket = process.env.R2_BUCKET!;
       const publicBase = process.env.R2_PUBLIC_BASE!; // 공개 URL 베이스
       const key = `assets/email-blast/${crypto.randomUUID()}.${ext}`;
       // ...S3 PutObject (ContentType: contentType, CacheControl 권장)...
       return `${publicBase}/${key}`;
     }
   }
   ```

2. **레지스트리 등록**: `lib/storage/index.ts` 의 `ADAPTERS` 에 한 줄.

   ```ts
   const ADAPTERS = {
     azure: () => new AzureAdapter(),
     r2: () => new R2Adapter(),   // ← 추가
   };
   ```

3. **스위치 변경**: `brand.config.ts` → `assets.provider: "r2"`.

4. **키 추가**: `.env.local` 에 해당 스토리지 키(`R2_BUCKET`, `R2_PUBLIC_BASE`, 액세스 키 등).

> 호출부(`app/api/upload`, `app/api/logos`)와 검증 로직은 **건드리지 않는다.**
> provider 이름이 `ADAPTERS` 에 없으면 시작 시 명확한 에러로 알려준다.
>
> ⚠️ 반환 URL은 **메일 클라이언트가 외부에서 로드**하므로 반드시 인증 없이 열리는
> 공개 URL이어야 한다(서명 URL·비공개 버킷 불가). 캐시 헤더
> `public, max-age=31536000, immutable` 권장.

---

## 4. 앱 UI 색상 (선택)

이메일 색과 별개로, **앱 화면(콘솔)의 브랜드 색**은 `app/globals.css` 상단의 CSS 변수다.
라이트/다크 각각 4개만 바꾸면 된다:

```css
--brand        /* 강조색 (버튼·탭·포인트) */
--brand-deep   /* 진한 강조 */
--brand-mint   /* CTA 그라데이션 밝은 쪽 */
--rail         /* 좌측 세로 레일 */
```

값은 `R G B`(0~255) 공백 구분 채널 형식. 이메일 톤과 맞추려면 `brand.config.ts`의
`email.colors`와 같은 색을 RGB로 환산해 넣는다. (블록 에디터의 강조색은
`brand.config.email.colors.teal`을 따라가도록 이미 연결돼 있다.)

---

## 5. 외부 설정 (DNS·OAuth·발송 도메인) — 발송 전 필수

코드/설정만으론 부족하고, 외부 서비스 등록이 필요하다.

### 5-1. Google OAuth redirect URI 등록
1. [Google Cloud Console](https://console.cloud.google.com) → **API 및 서비스 → 사용자 인증 정보**
2. 사용하는 OAuth 2.0 클라이언트 ID 클릭
3. **승인된 리디렉션 URI**에 다음을 각각 추가:
   - 로컬: `http://localhost:3001/api/auth/google/callback`
   - 배포: `https://<배포도메인>/api/auth/google/callback`
4. 저장. (클라이언트 ID/시크릿은 `.env.local`의 `GOOGLE_CLIENT_*`)

### 5-2. 발송 도메인 인증 (전달성의 핵심)
1. [Resend](https://resend.com) → **Domains → Add Domain** → 본인 발신 도메인 입력
2. Resend가 주는 **SPF·DKIM(·DMARC)** DNS 레코드를 도메인 DNS에 등록
3. Resend에서 **Verified** 확인. *미설정 시 Gmail/Outlook이 거부·스팸 처리 → 전달성 붕괴*
4. `brand.config.ts`의 `senders.builtinFrom`·`auth.senderDomain`이 이 도메인과 일치해야 함

### 5-3. (선택) Webhook·모니터링
- **Webhook**: Resend → Webhooks → Endpoint `https://<도메인>/api/webhooks/resend`,
  이벤트 `email.*` 구독 → Signing Secret을 `.env.local`의 `RESEND_WEBHOOK_SECRET`로
- **헬스체크**: `https://<도메인>/api/health` 를 UptimeRobot 등으로 감시

### 5-4. DNS A 레코드
- 배포 도메인 → 서버 IP로 A 레코드 등록 (예: Caddy/미니PC 환경)

---

## 6. Git 운용

개인 레포에서 혼자 개발하므로 별도 remote 운용이 필요 없다. `brand.config.ts`는
**그냥 커밋한다**(prod 빌드에 필요하고, 본인만 쓰므로 분리할 이유 없음).

> (참고) 나중에 다른 원본 코드의 업데이트를 받고 싶어지면 그때
> `git remote add upstream <repo>` → `git fetch/merge upstream` 으로 가져오고,
> `brand.config.ts`가 충돌하면 `git checkout --ours brand.config.ts`로 내 브랜드를
> 유지하면 된다. 브랜드 값이 이 한 파일에 격리돼 있어 충돌도 여기서만 난다.

---

## 7. 옮길 때 체크리스트

- [ ] `.env.local`에 본인 키 전부 채움 (1절 표)
- [ ] `brand.config.ts` 상단 기준값 6개 교체 (COMPANY·도메인 2개·웹사이트·ASSET_BASE)
- [ ] `senders.builtinFrom` / `replyToDefault`를 본인 발신 주소로
- [ ] 로고·소셜 아이콘 업로드 후 `email.*` URL 교체 (3절)
- [ ] (선택) `globals.css` 앱 UI 색상 (4절)
- [ ] Google OAuth redirect URI 등록 (5-1)
- [ ] 발송 도메인 SPF/DKIM 인증 (5-2) ← **이거 안 하면 메일이 스팸/거부**
- [ ] `SENDER_POSTAL_ADDRESS` 채움 (외부 발송 시 법적 의무)
- [ ] `npm test` 통과 확인 → `npm run build` → 배포
