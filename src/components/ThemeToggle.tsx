"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function apply(t: Theme) {
  if (t === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

/** Light/dark theme state + toggle — synced with localStorage(eb-theme) and <html data-theme>. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = (localStorage.getItem("eb-theme") as Theme) || "light";
    setTheme(saved);
    apply(saved);
  }, []);

  function toggle() {
    setTheme((cur) => {
      const next: Theme = cur === "dark" ? "light" : "dark";
      apply(next);
      localStorage.setItem("eb-theme", next);
      return next;
    });
  }

  return { theme, toggle };
}

export default function ThemeToggle({ className = "icon-btn" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} className={className} title={theme === "dark" ? "라이트 모드" : "다크 모드"}>
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
