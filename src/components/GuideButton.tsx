"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

// The guide body (text + 34 image references) is fetched only when opened.
const GuideDialog = dynamic(() => import("./GuideDialog"), { ssr: false });

/** The (!) button in the top bar — opens the user guide modal. */
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
