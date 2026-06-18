/** @type {import('next').NextConfig} */

// 앱 전역 보안 헤더. CSP 는 Next inline 스크립트/스타일·Pretendard CDN·미리보기 iframe 과의
// 충돌 위험이 있어 전역으로 강하게 걸지 않고, 첨부 HTML 을 서빙하는 라우트(미리보기·수신거부)에서
// 라우트별 'Content-Security-Policy: sandbox' 로 스크립트 실행을 차단한다(저장형 XSS 방어).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 미리보기 iframe 은 same-origin 으로 임베드되므로 SAMEORIGIN (DENY 면 자기 미리보기도 깨짐).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // HTTPS(Caddy) 뒤에서만 의미. 1년 + 서브도메인.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
    ];
  },
};
