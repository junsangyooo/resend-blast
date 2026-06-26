"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export default function ThemeToggle({ className = "icon-btn" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = (localStorage.getItem("eb-theme") as Theme) || "light";
    setTheme(saved);
    apply(saved);
  }, []);

  function apply(t: Theme) {
    if (t === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
  }

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
    localStorage.setItem("eb-theme", next);
  }

  return (
    <button onClick={toggle} className={className} title={theme === "dark" ? "라이트 모드" : "다크 모드"}>
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
