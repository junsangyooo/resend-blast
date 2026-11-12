"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

// 가이드 본문(텍스트 + 34장 참조)은 열 때만 받아온다.
const GuideDialog = dynamic(() => import("./GuideDialog"), { ssr: false });

/** 탑바의 (!) 버튼 — 누르면 사용 가이드 모달이 열린다. */
export default function GuideButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="사용 가이드"
        aria-label="사용 가이드"
        className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-full border border-border
                   text-[13px] font-bold text-muted transition hover:border-brand/60 hover:text-brand"
      >
        !
      </button>
      {open && <GuideDialog onClose={() => setOpen(false)} />}
    </>
  );
}
