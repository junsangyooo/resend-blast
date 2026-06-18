/**
 * ────────────────────────────────────────────────────────────────────────────
 *  BRAND CONFIG — 화이트라벨 단일 설정 소스 (white-label single source of truth)
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  이 파일 하나만 바꾸면 앱 전체가 다른 회사/개인 브랜드로 전환된다.
 *  코드 본문(lib/, app/)에는 어떤 브랜드 종속 값도 하드코딩하지 않는다 — 전부 여기서 import.
 *
 *  ⚠️  비밀(secret)은 절대 여기 넣지 말 것.
 *      API 키·토큰·시크릿·비밀번호는 `.env.local` 에만. 이 파일은 클라이언트 번들에
 *      포함될 수 있으므로 "공개돼도 되는 브랜드 정보"만 담는다.
 *
 *  ⚠️  일부 값은 환경변수 override 를 허용한다(배포 환경별로 달라지는 것).
 *      env 가 있으면 env 우선, 없으면 아래 기본값.
 *
 *  ── 이 파일은 "예시 템플릿" 이다 ──
 *  아래 값들은 전부 placeholder(example.com 등)다. 본인 브랜드로 옮길 때:
 *    1) 맨 위 "파생 기준값" 6개를 본인 값으로 교체 → 대부분 자동 전파
 *    2) 섹션별 세부값(발신자·색상·로고·소셜) 조정
 *    3) 키는 `.env.local` 에, DNS·OAuth·발송도메인은 외부 서비스에 등록
 *  상세 절차·체크리스트는 docs/WHITELABEL.md 참고.
 * ────────────────────────────────────────────────────────────────────────────
 */

// ── 파생 기준값 (한 곳만 바꾸면 아래 문구·발신자에 전파) ──
// ↓↓↓ 본인 브랜드로 옮길 때 이 6개부터 교체한다 ↓↓↓
const COMPANY = "Acme";                                    // 회사/서비스 표시명 (헤더·로그인·푸터·프리셋)
const LEGAL_NAME = "Acme Inc.";                            // 법적 전송자 명칭 (컴플라이언스 푸터)
// 도메인은 순수 상수로 고정한다. UI(클라이언트 컴포넌트)가 이 값을 렌더하므로
// process.env 에 의존하면 서버/클라 hydration 불일치가 난다. 변경은 이 파일에서.
const LOGIN_DOMAIN = "example.com";                        // 로그인 허용 Workspace 도메인 (Google OAuth 모드용)
const SENDER_DOMAIN = "send.example.com";                  // 발신(From/Reply-To) 허용 도메인 (★발송 차단의 핵심)
const WEBSITE_URL = "https://www.example.com";             // 회사 홈페이지 (이메일 푸터 로고 링크)

// 이미지(로고·아이콘) 호스팅 베이스 — 공개 읽기 가능한 CDN/버킷 URL.
// 메일 클라이언트가 외부에서 로드하므로 반드시 인증 없이 열리는 공개 URL이어야 한다.
// 본인 로고/아이콘을 올린 뒤(Azure Blob·Cloudflare R2·S3 등) 이 베이스를 교체한다.
const ASSET_BASE = "https://cdn.example.com/assets";

export type BrandFromOption = { value: string; label: string; builtin?: boolean };
export type BrandLogo = { id: string; label: string; url: string; width: number };

export const brand = {
  // ── 정체성 ──────────────────────────────────────────────────────────────
  identity: {
    companyName: COMPANY,
    legalName: LEGAL_NAME,
    appName: "Email Blast",
    appTitle: `${COMPANY} Email Blast`,
    appDescription: "Internal email blast tool",
    websiteUrl: WEBSITE_URL,
    /** 앱 공개 베이스 URL (수신거부 링크 등 발송 루프에서 사용). env(APP_BASE_URL) override. */
    appBaseUrl: (process.env.APP_BASE_URL || "https://email-blast.example.com").replace(/\/+$/, ""),
  },

  // ── 인증/도메인 ─────────────────────────────────────────────────────────
  auth: {
    /** Google Workspace 로그인 허용 도메인 (순수 상수 — 위 LOGIN_DOMAIN 참고). */
    loginDomain: LOGIN_DOMAIN,
    /** 발신자(From)·회신(Reply-To)에 허용되는 이메일 도메인. */
    senderDomain: SENDER_DOMAIN,
  },

  // ── 발신자 / 컴플라이언스 ──────────────────────────────────────────────
  senders: {
    /** 내장 발신자(항상 존재, 삭제 불가). 운영자 추가분은 data/from.json.
     *  ⚠️ 최소 1개는 있어야 한다 (FROM_DEFAULT 가 [0] 을 참조). senderDomain 과 일치시킬 것. */
    builtinFrom: [
      { value: `${COMPANY} <hello@${SENDER_DOMAIN}>`, label: COMPANY, builtin: true },
    ] as BrandFromOption[],
    /** 회신(Reply-To) 기본값. */
    replyToDefault: "inquiry@example.com",
    /** 전송자 명칭 (정보통신망법 제50조 제4항). env(SENDER_ORG_NAME) override. */
    orgName: process.env.SENDER_ORG_NAME || LEGAL_NAME,
    /** 발신자 물리 우편주소 (CAN-SPAM). 비어있으면 푸터에서 생략. env(SENDER_POSTAL_ADDRESS) override.
     *  ⚠️ 외부 발송 전 반드시 채울 것 (법적 의무). */
    postalAddress: process.env.SENDER_POSTAL_ADDRESS || "",
    /** 컴플라이언스 연락 이메일 (수신거부 mailto). env(SENDER_CONTACT_EMAIL) override. */
    contactEmail: process.env.SENDER_CONTACT_EMAIL || "inquiry@example.com",
  },

  // ── 이메일 본문 렌더 (lib/blocks.ts) ───────────────────────────────────
  email: {
    /** 디자인 시스템 고정 색상. 비개발자도 항상 온브랜드. 본인 브랜드 색으로 교체. */
    colors: {
      teal: "#0d8a7e",          // 강조/포인트 (kicker·번호·stat)
      mint: "#50EACE",          // CTA 버튼 배경
      ink: "#0a0a0a",           // 제목
      body: "#4a4a4a",          // 본문
      sub: "#6a6a6a",           // 보조 텍스트
      muted: "#888888",         // 푸터/코멘트
      hair: "#f0f0f0",          // 구분선
      cardBorder: "#e0e3e6",    // 카드 테두리
      tealTintBg: "#eef7f5",    // 배지 배경
      tealTintBorder: "#d6ebe8",// 배지 테두리
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
  // 업로드된 이미지를 저장하는 백엔드 선택 + 호스팅 공개 URL 베이스.
  // provider 만 바꾸면 스토리지가 교체된다 (어댑터: lib/storage/adapters/*).
  // ⚠️ 여기엔 provider 이름·공개 URL만. 자격증명(키)은 .env.local 에서.
  // 새 스토리지 추가 절차는 docs/WHITELABEL.md "스토리지 백엔드 교체" 참고.
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

  // ── 앱 UI 텍스트 ───────────────────────────────────────────────────────
  ui: {
    /** 상단 헤더 워드마크. */
    headerBrand: COMPANY,
    /** 수신거부/재구독 공개 페이지 하단 워드마크. */
    footerWordmark: COMPANY,
    login: {
      title: `${COMPANY} Email Blast`,
      subtitle: `${COMPANY} 계정으로 로그인하세요.`,
      domainNotice: `@${LOGIN_DOMAIN} 계정만 접근할 수 있습니다.`,
      domainError: `@${LOGIN_DOMAIN} 계정만 로그인할 수 있습니다.`,
    },
  },
};

export type Brand = typeof brand;
