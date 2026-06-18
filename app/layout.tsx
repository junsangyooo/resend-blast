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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
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
