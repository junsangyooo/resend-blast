"use client";

import { useEffect } from "react";

/** 모달 ESC 닫기 — 활성일 때 Escape 키로 onClose 호출. */
export function useEscClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, onClose]);
}
