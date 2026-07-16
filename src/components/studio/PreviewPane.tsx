"use client";
// 라이브 미리보기 — spec 은 서버 렌더(/api/templates/render, 700ms 디바운스), html 은 직접 srcDoc.
import { useEffect, useRef, useState } from "react";
import type { TemplateSpec } from "@/lib/blocks";

export default function PreviewPane({ spec, html }: { spec?: TemplateSpec; html?: string }) {
  const [doc, setDoc] = useState("");
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (html !== undefined) { seq.current++; setDoc(html); return; }
    if (!spec) return;
    if (timer.current) clearTimeout(timer.current);
    const my = ++seq.current;
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/templates/render", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec }),
        });
        if (!r.ok) return; // keep last good doc (finally still clears loading)
        const j = await r.json();
        if (my === seq.current && typeof j.html === "string") setDoc(j.html);
      } catch { /* keep last */ } finally { if (my === seq.current) setLoading(false); }
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [spec, html]);

  return (
    <div className="relative h-full min-h-0">
      {loading && <div className="absolute top-2 right-2 z-10 text-[10px] text-muted bg-surface/80 rounded px-1.5 py-0.5">렌더 중…</div>}
      <iframe title="preview" sandbox="allow-same-origin" className="w-full h-full rounded-xl border border-border bg-white"
        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${doc}</body></html>`} />
    </div>
  );
}
