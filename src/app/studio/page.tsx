"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { type Block, type TemplateSpec } from "@/lib/blocks";
import { validateSpec } from "@/lib/ai/spec-validate";
import { RichTextProvider } from "@/components/studio/RichText";
import BlockList from "@/components/studio/BlockList";
import HeaderFooterBar from "@/components/studio/HeaderFooterBar";
import PreviewPane from "@/components/studio/PreviewPane";
import ChatPanel from "@/components/studio/ChatPanel";

function skeletonSpec(): TemplateSpec {
  return { subject: "", preheader: "", showLogo: true, showFooter: true, footer: { showSocial: true, showUnsubscribe: true }, blocks: [] };
}

export default function StudioPage() {
  return <Suspense fallback={null}><Studio /></Suspense>;
}

function Studio() {
  const router = useRouter();
  const params = useSearchParams();
  const editName = params.get("edit");

  const [mode, setMode] = useState<"spec" | "html">("spec");
  const [loading, setLoading] = useState(!!editName);
  const [spec, setSpec] = useState<TemplateSpec>(skeletonSpec);
  const [htmlBody, setHtmlBody] = useState("");
  const [htmlSubject, setHtmlSubject] = useState("");
  const [name, setName] = useState(editName ?? "");
  const [description, setDescription] = useState("");
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const specRef = useRef(spec); specRef.current = spec;
  const htmlRef = useRef(htmlBody); htmlRef.current = htmlBody;
  const changedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editName) return;
    let cancel = false;
    (async () => {
      const s = await fetch(`/api/templates/spec?name=${encodeURIComponent(editName)}`).then((r) => r.json()).catch(() => null);
      if (cancel) return;
      if (s?.spec) { setMode("spec"); setSpec(s.spec); setDescription(s.description ?? ""); }
      else {
        const b = await fetch(`/api/templates/body?name=${encodeURIComponent(editName)}`).then((r) => r.json()).catch(() => null);
        if (cancel) return;
        if (b?.body) { setMode("html"); setHtmlBody(b.body); setHtmlSubject(b.subject ?? ""); setDescription(b.description ?? ""); }
        else setErr("이메일을 불러오지 못했습니다");
      }
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [editName]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const onAiResult = useCallback((r: { spec?: unknown; html?: string }) => {
    setDirty(true);
    if (r.html !== undefined) { setHtmlBody(r.html); return; }
    const v = validateSpec(r.spec);           // 서버가 이미 검증했지만 방어적 재검증
    if (!v.ok) { setErr("AI 결과 형식 오류"); return; }
    const prev = new Map(specRef.current.blocks.map((b) => [b.id, JSON.stringify(b)]));
    const changed = new Set<string>();
    for (const b of v.spec.blocks) if (prev.get(b.id) !== JSON.stringify(b)) changed.add(b.id);
    setSpec(v.spec);
    setChangedIds(changed);
    if (changedTimer.current) clearTimeout(changedTimer.current);
    changedTimer.current = setTimeout(() => setChangedIds(new Set()), 4000);
  }, []);

  useEffect(() => () => { if (changedTimer.current) clearTimeout(changedTimer.current); }, []);

  const onBlocksChange = useCallback((blocks: Block[]) => { setDirty(true); setSpec((s) => ({ ...s, blocks })); }, []);
  const patchSpec = useCallback((p: Partial<TemplateSpec>) => { setDirty(true); setSpec((s) => ({ ...s, ...p })); }, []);
  const patchFooter = useCallback((p: Partial<NonNullable<TemplateSpec["footer"]>>) => { setDirty(true); setSpec((s) => ({ ...s, footer: { ...s.footer, ...p } })); }, []);

  const nameInvalid = name.trim() ? !/^[A-Za-z0-9_-]+$/.test(name.trim()) : false;

  async function save() {
    setErr("");
    const trimmed = name.trim();
    if (!trimmed || nameInvalid) { setErr("이메일 이름(영문/숫자/하이픈/언더스코어)을 입력하세요"); return; }
    setSaving(true);
    try {
      let r: Response;
      if (mode === "spec") {
        const cur = specRef.current;
        if (!cur.subject.trim()) throw new Error("이메일 제목을 입력하세요");
        if (cur.blocks.length === 0) throw new Error("블록이 없습니다 — 채팅으로 생성하거나 직접 추가하세요");
        r = await fetch("/api/templates/compose", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, spec: cur, description, overwrite: !!editName }),
        });
      } else {
        r = await fetch("/api/templates", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, subject: htmlSubject, body: htmlRef.current, description, overwrite: !!editName }),
        });
      }
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error ?? "저장 실패");
      setDirty(false);
      router.push("/");
    } catch (e: any) { setErr(e?.message ?? "저장 실패"); } finally { setSaving(false); }
  }

  const getCurrent = useCallback(() => (mode === "spec" ? specRef.current : htmlRef.current), [mode]);

  if (loading) return <div className="p-10 text-sm text-muted">불러오는 중…</div>;

  return (
    <RichTextProvider>
      <div className="h-screen flex flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <button className="btn-ghost text-[13px]" onClick={() => { if (!dirty || window.confirm("나가면 대화와 작업 내용이 사라집니다. 나갈까요?")) router.push("/"); }}>← 목록</button>
          <span className="kicker">{editName ? "이메일 편집" : "새 이메일 생성"}{mode === "html" && " · HTML"}</span>
          <input className="input max-w-xs text-[13px] py-1.5" value={name} disabled={!!editName}
            placeholder="이메일 이름 (예: demo-day-invite)" onChange={(e) => setName(e.target.value)} />
          {mode === "html" && (
            <input className="input max-w-sm text-[13px] py-1.5" value={htmlSubject} placeholder="이메일 제목"
              onChange={(e) => { setDirty(true); setHtmlSubject(e.target.value); }} />
          )}
          {err && <span className="text-xs text-red-500">{err}</span>}
          <button className="btn-primary ml-auto text-[13px]" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        </header>
        <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: mode === "spec" ? "minmax(320px,1fr) minmax(360px,1.2fr) minmax(360px,1fr)" : "minmax(360px,1fr) minmax(480px,1.4fr)" }}>
          <section className="border-r border-border min-h-0"><ChatPanel mode={mode} getCurrent={getCurrent} onResult={onAiResult} /></section>
          {mode === "spec" && (
            <section className="border-r border-border min-h-0 overflow-y-auto p-3 pb-10 space-y-3 bg-surface2/30">
              <HeaderFooterBar spec={spec} onPatch={patchSpec} onPatchFooter={patchFooter}
                onDefaultLogo={editName ? undefined : (logo) => setSpec((s) => (s.logo ? s : { ...s, logo }))} />
              <BlockList blocks={spec.blocks} onChange={onBlocksChange} changedIds={changedIds} />
            </section>
          )}
          <section className="min-h-0 p-3 pb-5">
            {mode === "spec" ? <PreviewPane spec={spec} /> : <PreviewPane html={htmlBody} />}
          </section>
        </div>
      </div>
    </RichTextProvider>
  );
}
