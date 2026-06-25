// Single source of truth for theme presets. Consumed by both the init wizard
// and the browser palette page (theme-picker.html) so palette values never drift.
export const THEMES = [
  { id: "indigo",   name: "Indigo",   vibe: "테크·SaaS 기본",      accent: "#5b5bf0", cta: "#7c7cff", deep: "#4a4ad6", tint: "#eef0ff" },
  { id: "ocean",    name: "Ocean",    vibe: "신뢰·기업·클래식",    accent: "#2563eb", cta: "#3b82f6", deep: "#1d4ed8", tint: "#eff4ff" },
  { id: "emerald",  name: "Emerald",  vibe: "성장·친환경·헬스",    accent: "#0f9d6e", cta: "#14b886", deep: "#0a7d57", tint: "#e7f7f0" },
  { id: "crimson",  name: "Crimson",  vibe: "이벤트·강렬·리테일",  accent: "#e11d48", cta: "#f43f5e", deep: "#be123c", tint: "#ffeef1" },
  { id: "amber",    name: "Amber",    vibe: "따뜻함·F&B·캠페인",   accent: "#d97706", cta: "#f59e0b", deep: "#b45309", tint: "#fff4e2" },
  { id: "graphite", name: "Graphite", vibe: "미니멀·모노·프리미엄", accent: "#111827", cta: "#374151", deep: "#0b1220", tint: "#f0f1f3" },
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id);
}

export function appTokensFor(id) {
  const t = getTheme(id);
  if (!t) throw new Error(`unknown theme: ${id}`);
  return { APP_ACCENT: t.accent, APP_ACCENT_BRIGHT: t.cta, APP_ACCENT_DEEP: t.deep };
}
