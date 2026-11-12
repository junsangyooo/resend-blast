"use client";

import { useRef, useState } from "react";
import { GUIDE_SECTIONS } from "@/lib/guide-content";

/**
 * Usage guide body — top tabs (the document's H2s) + scrolling content.
 * Shared by the modal (GuideDialog) and the full page (/guide).
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
        {/* html is not user input but a generated artifact committed to the repo (lib/guide-content.ts),
            and code spans and code blocks were all escaped during conversion. No runtime input reaches here. */}
        <article className="guide mx-auto max-w-[800px]" dangerouslySetInnerHTML={{ __html: section.html }} />
      </div>
    </div>
  );
}
