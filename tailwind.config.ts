import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        surface2: "rgb(var(--surface2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        rail: "rgb(var(--rail) / <alpha-value>)",
        onBrand: "rgb(var(--on-brand) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "Pretendard Variable", "Pretendard",
          "-apple-system", "BlinkMacSystemFont", "system-ui",
          "Apple SD Gothic Neo", "Noto Sans KR", "sans-serif",
        ],
        mono: ["Menlo", "SF Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
