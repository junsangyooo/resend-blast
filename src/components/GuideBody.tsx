"use client";

import { useRef, useState } from "react";
import { GUIDE_SECTIONS } from "@/lib/guide-content";

/**
 * 사용 가이드 본문 — 상단 탭(문서의 H2) + 스크롤 본문.
 * 모달(GuideDialog)과 전체 페이지(/guide)가 공유한다.
 */
export default function GuideBody() {
  const [active, setActive] = useState(GUIDE_SECTIONS[0]?.id ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);
  const section = GUIDE_SECTIONS.find((s) => s.id === active);
  if (!section) return <p className="p-6 text-[13px] text-muted">가이드 없음 · npm run guide 로 생성</p>;

  function select(id: string) {
    setActive(id);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <nav className="shrink-0 border-b border-border px-4 flex gap-1 overflow-x-auto no-scrollbar">
        {GUIDE_SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => select(s.id)}
            className={`shrink-0 px-3 py-3 text-[13px] font-medium border-b-2 -mb-px transition whitespace-nowrap
              ${s.id === active ? "border-brand text-brand" : "border-transparent text-muted hover:text-text"}`}
          >
            {s.title}
          </button>
        ))}
      </nav>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-5 sm:px-7">
        {/* html 은 사용자 입력이 아니라 저장소에 커밋된 생성물(lib/guide-content.ts)이고,
            변환 시 코드 스팬·코드블록을 전부 escape 했다. 런타임 입력은 여기 들어오지 않는다. */}
        <article className="guide mx-auto max-w-[800px]" dangerouslySetInnerHTML={{ __html: section.html }} />
      </div>
    </div>
  );
}
