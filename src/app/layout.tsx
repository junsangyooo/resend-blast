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

/** "#5b5bf0" → "91 91 240" (the rgb(var(--brand)) channel format in globals.css). */
function rgbChannels(hex: string): string {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// Inject the app console accent color from brand.config → same palette as emails.
// The :root inline style overrides the :root rule in globals.css (shared brand color for light/dark).
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
