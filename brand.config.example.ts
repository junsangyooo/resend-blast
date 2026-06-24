/**
 * ────────────────────────────────────────────────────────────────────────────
 *  BRAND CONFIG — 화이트라벨 단일 설정 소스 (white-label single source of truth)
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  이 파일 하나(+ 비밀은 .env.local)만 바꾸면 앱 전체가 다른 회사/개인 브랜드로 전환된다.
 *  코드 본문(lib/, app/)에는 어떤 브랜드 종속 값도 하드코딩하지 않는다 — 전부 여기서 import.
 *
 *  ⚠️  비밀(secret)은 절대 여기 넣지 말 것.
 *      API 키·토큰·시크릿·비밀번호는 `.env.local` 에만. 이 파일은 클라이언트 번들에
 *      포함될 수 있으므로 "공개돼도 되는 브랜드 정보"만 담는다.
 *
 *  ── 처음 쓰는 사람에게 ──
 *  1) 맨 위 "브랜드 기준값"과 "디자인 토큰"을 본인 값으로 교체 → 앱·이메일 전체에 전파
 *  2) `auth.mode` 로 로그인 방식 선택 (password = 간단 / google = Workspace)
 *  3) `.env.local` 에 키 채우기 (.env.local.example 복사)
 *  상세 절차·발급처는 docs/SETUP.md, 화이트라벨 구조는 docs/WHITELABEL.md.
 * ────────────────────────────────────────────────────────────────────────────
 */

// ── 브랜드 기준값 (한 곳만 바꾸면 문구·발신자에 전파) ──────────────────────────
const COMPANY = "Acme";                                    // 회사/서비스 표시명
const LEGAL_NAME = "Acme Inc.";                            // 법적 전송자 명칭 (컴플라이언스 푸터)
// 도메인은 순수 상수로 고정한다(클라이언트가 렌더 → env 의존 시 hydration 불일치).
const LOGIN_DOMAIN = "example.com";                        // Google 로그인 허용 Workspace 도메인 (google 모드용)
const SENDER_DOMAIN = "send.example.com";                  // 발신(From) 허용 도메인 (★발송 차단의 핵심)
const WEBSITE_URL = "https://www.example.com";             // 회사 홈페이지 (이메일 푸터 로고 링크)

// 이미지(로고·아이콘) 호스팅 베이스 — 공개 읽기 가능한 CDN/버킷 URL.
const ASSET_BASE = "https://cdn.example.com/assets";

// ── 디자인 토큰 (의미 단위) ────────────────────────────────────────────────────
//  이 색들만 바꾸면 "이메일 본문 + 앱 콘솔 UI" 디자인이 한 번에 전환된다.
//  (이메일은 lib/blocks.ts, 앱 UI는 app/layout.tsx 가 여기서 색을 주입받는다.)
const PRIMARY        = "#5b5bf0";   // 브랜드 강조 — 링크·kicker·번호·통계·앱 액센트
const PRIMARY_CTA    = "#7c7cff";   // CTA 버튼 배경 (그라데이션 밝은 쪽)
const PRIMARY_DEEP   = "#4a4ad6";   // 진한 강조 — 앱 좌측 레일·hover
const TEXT_HEADING   = "#0f0f1a";   // 제목
const TEXT_BODY      = "#4a4a55";   // 본문
const TEXT_SUB       = "#6a6a75";   // 보조 텍스트
const TEXT_MUTED     = "#8a8a95";   // 푸터/코멘트
const HAIRLINE       = "#eceef5";   // 얇은 구분선
const CARD_BORDER    = "#e0e2ec";   // 카드(그리드) 테두리
const TINT_BG        = "#eef0ff";   // 배지/강조 배경
const TINT_BORDER    = "#dce0ff";   // 배지 테두리
const EMAIL_PAGE_BG  = "#f5f5f5";   // 이메일 바깥 페이지 배경
const EMAIL_SURFACE  = "#ffffff";   // 이메일 카드 배경
const EMAIL_SURFACE_BORDER = "#e5e5e5"; // 이메일 카드 테두리

export type BrandFromOption = { value: string; label: string; builtin?: boolean };
export type BrandLogo = { id: string; label: string; url: string; width: number };

export const brand = {
  // ── 정체성 ──────────────────────────────────────────────────────────────
  identity: {
    companyName: COMPANY,
    legalName: LEGAL_NAME,
    appName: "Email Blast",
    appTitle: `${COMPANY} Email Blast`,
    appDescription: "Email blast tool",
    websiteUrl: WEBSITE_URL,
    /** 앱 공개 베이스 URL (수신거부 링크 등 발송 루프에서 사용). env(APP_BASE_URL) override. */
    appBaseUrl: (process.env.APP_BASE_URL || "https://email-blast.example.com").replace(/\/+$/, ""),
  },

  // ── 인증/도메인 ─────────────────────────────────────────────────────────
  auth: {
    /** 로그인 방식 스위치 — 이 한 줄로 두 버전을 전환한다.
     *   "password" : 구글 없이 단일 비밀번호 게이트(비번 값은 .env.local 의 ACCESS_PASSWORD).
     *   "google"   : Google Workspace 로그인(@loginDomain 제한). GOOGLE_CLIENT_* 필요. */
    mode: "password" as "password" | "google",
    /** password 모드의 단일 운영자 신원 = 자동 관리자. (세션·발신자 소유·감사에 사용) */
    operatorEmail: "you@example.com",
    /** password 모드 운영자 표시 이름(발신 표시명 자동 생성에 사용). 비우면 이메일에서 유추. */
    operatorName: COMPANY,
    /** Google Workspace 로그인 허용 도메인 (google 모드용). */
    loginDomain: LOGIN_DOMAIN,
    /** 발신자(From)에 허용되는 이메일 도메인. */
    senderDomain: SENDER_DOMAIN,
  },

  // ── 발신자 / 컴플라이언스 ──────────────────────────────────────────────
  senders: {
    /** 내장 발신자(항상 존재, 삭제 불가). 운영자 추가분은 data/from.json.
     *  ⚠️ 최소 1개 필요 (FROM_DEFAULT 가 [0] 참조). senderDomain 과 일치시킬 것. */
    builtinFrom: [
      { value: `${COMPANY} <hello@${SENDER_DOMAIN}>`, label: COMPANY, builtin: true },
    ] as BrandFromOption[],
    /** 회신(Reply-To) 기본값. senderDomain 밖(예: gmail)이어도 이 값은 허용된다(resolveReplyTo). */
    replyToDefault: "inquiry@example.com",
    /** 전송자 명칭 (정보통신망법 제50조 제4항). env(SENDER_ORG_NAME) override. */
    orgName: process.env.SENDER_ORG_NAME || LEGAL_NAME,
    /** 발신자 물리 우편주소 (CAN-SPAM). 비면 푸터에서 생략. env(SENDER_POSTAL_ADDRESS) override.
     *  ⚠️ 외부 발송 전 반드시 채울 것 (법적 의무). */
    postalAddress: process.env.SENDER_POSTAL_ADDRESS || "",
    /** 컴플라이언스 연락 이메일 (수신거부 mailto). env(SENDER_CONTACT_EMAIL) override. */
    contactEmail: process.env.SENDER_CONTACT_EMAIL || "inquiry@example.com",
  },

  // ── 이메일 본문 렌더 (lib/blocks.ts) ───────────────────────────────────
  email: {
    /** 이메일 색상. ⚠️ 키 이름(teal/mint/tealTint…)은 lib/blocks.ts·UI 토큰이 참조하므로
     *  바꾸지 말 것 — 값은 위 "디자인 토큰"에서 파생된다(한 곳에서 관리). */
    colors: {
      teal: PRIMARY,            // 강조/포인트 (kicker·번호·stat·링크)
      mint: PRIMARY_CTA,        // CTA 버튼 배경
      ink: TEXT_HEADING,        // 제목
      body: TEXT_BODY,          // 본문
      sub: TEXT_SUB,            // 보조 텍스트
      muted: TEXT_MUTED,        // 푸터/코멘트
      hair: HAIRLINE,           // 구분선
      cardBorder: CARD_BORDER,  // 카드 테두리
      tealTintBg: TINT_BG,      // 배지 배경
      tealTintBorder: TINT_BORDER, // 배지 테두리
    },
    /** 이메일 골격 색(페이지 배경·카드). 위 디자인 토큰에서 파생. */
    surfaces: {
      pageBg: EMAIL_PAGE_BG,
      card: EMAIL_SURFACE,
      cardBorder: EMAIL_SURFACE_BORDER,
    },
    mono: "Menlo,'SF Mono',Consolas,'Liberation Mono',monospace",
    /** 헤더(상단) 기본 로고 — spec.logo 미설정 시 사용. 본인 로고 공개 URL로 교체. */
    headerLogo: { url: `${ASSET_BASE}/header-logo.png`, alt: COMPANY, width: 130 },
    /** 푸터(하단) 로고 + 클릭 링크. */
    footerLogo: { url: `${ASSET_BASE}/footer-logo.png`, alt: COMPANY, link: WEBSITE_URL, width: 100, height: 16 },
    /** 푸터 소셜 아이콘 이미지. */
    socialIcons: {
      x: `${ASSET_BASE}/x-logo.png`,
      linkedin: `${ASSET_BASE}/linkedin-logo.png`,
      youtube: `${ASSET_BASE}/youtube-logo.png`,
    },
    /** 푸터 소셜 링크 (빈 문자열이면 해당 아이콘 자동 숨김). 본인 SNS 있으면 채울 것. */
    social: {
      x: "",
      linkedin: "",
      youtube: "",
    },
    /** 푸터 문의 이메일 기본값 (footer.inquiryEmail 미설정 시). */
    defaultInquiry: "inquiry@example.com",
  },

  // ── 자산(이미지) 스토리지 ───────────────────────────────────────────────
  // provider 만 바꾸면 스토리지가 교체된다 (어댑터: lib/storage/adapters/*).
  // ⚠️ 여기엔 provider 이름·공개 URL만. 자격증명(키)은 .env.local 에서.
  assets: {
    /** 사용할 스토리지 어댑터 키 (lib/storage/index.ts 의 ADAPTERS 와 일치). */
    provider: "azure",
    /** 내장 로고·아이콘 호스팅 베이스 (메일에 박히는 이미지의 공개 URL). */
    base: ASSET_BASE,
  },

  // ── 헤더 로고 레지스트리 (lib/logos.ts 내장 목록) ──────────────────────
  logos: [
    { id: "primary", label: COMPANY, url: `${ASSET_BASE}/header-logo.png`, width: 130 },
  ] as BrandLogo[],

  // ── 템플릿 기본값 ───────────────────────────────────────────────────────
  templates: {
    defaultSubject: `[알림] ${COMPANY}`,
  },

  // ── 앱 UI ──────────────────────────────────────────────────────────────
  ui: {
    /** 상단 헤더 워드마크. */
    headerBrand: COMPANY,
    /** 수신거부/재구독 공개 페이지 하단 워드마크. */
    footerWordmark: COMPANY,
    /** 앱 콘솔(웹 UI) 강조색 — app/layout.tsx 가 :root CSS 변수로 주입(이메일 색과 통일).
     *  위 "디자인 토큰"에서 파생되므로 색은 한 곳에서만 바꾸면 된다. */
    appAccent: PRIMARY,         // → --brand / --ring
    appAccentDeep: PRIMARY_DEEP, // → --brand-deep / --rail
    appAccentBright: PRIMARY_CTA,// → --brand-mint (CTA 그라데이션 밝은 쪽)
    login: {
      title: `${COMPANY} Email Blast`,
      subtitle: `${COMPANY} 계정으로 로그인하세요.`,
      /** password 모드 로그인 화면 문구. */
      passwordSubtitle: `접근하려면 비밀번호를 입력하세요.`,
      domainNotice: `@${LOGIN_DOMAIN} 계정만 접근할 수 있습니다.`,
      domainError: `@${LOGIN_DOMAIN} 계정만 로그인할 수 있습니다.`,
      passwordError: `비밀번호가 올바르지 않습니다.`,
    },
  },
};

export type Brand = typeof brand;
