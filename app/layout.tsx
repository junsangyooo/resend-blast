import type { Metadata, Viewport } from "next";
import "./globals.css";
import { brand } from "@/brand.config";

export const metadata: Metadata = {
  metadataBase: new URL(brand.identity.appBaseUrl),
  title: brand.identity.appTitle,
  description: brand.identity.appDescription,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F0F2F5",
};

/** "#5b5bf0" → "91 91 240" (globals.css 의 rgb(var(--brand)) 채널 포맷). */
function rgbChannels(hex: string): string {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// 앱 콘솔 강조색을 brand.config 에서 주입 → 이메일과 동일 팔레트.
// :root 인라인 스타일은 globals.css 의 :root 규칙을 이긴다(라이트/다크 공통 브랜드색).
const brandVars: React.CSSProperties = {
  ["--brand" as string]: rgbChannels(brand.ui.appAccent),
  ["--brand-deep" as string]: rgbChannels(brand.ui.appAccentDeep),
  ["--brand-mint" as string]: rgbChannels(brand.ui.appAccentBright),
  ["--rail" as string]: rgbChannels(brand.ui.appAccentDeep),
  ["--ring" as string]: rgbChannels(brand.ui.appAccent),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" style={brandVars}>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
