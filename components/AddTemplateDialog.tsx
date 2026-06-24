"use client";

import { useEffect, useRef, useState } from "react";
import { useEscClose } from "./hooks";

type ExistingTemplate = { name: string; archived: boolean };

type Attachment = {
  id: string;
  name: string;          // original filename (src matching key)
  url: string | null;    // public URL after upload completes
  error?: string;
};

/** Whether the src value is an already-hosted (external) reference — excluded from replacement. */
function isRemoteSrc(v: string): boolean {
  return /^(https?:|data:|cid:|\/\/)/i.test(v.trim());
}
function basenameOf(p: string): string {
  const noq = p.split(/[?#]/)[0];
  const parts = noq.split(/[\\/]/);
  try { return decodeURIComponent(parts[parts.length - 1] ?? "").toLowerCase(); }
  catch { return (parts[parts.length - 1] ?? "").toLowerCase(); }
}

/** Replace local src with the uploaded public URL by filename matching. */
function replaceSrcs(html: string, atts: Attachment[]): string {
  return html.replace(/(src\s*=\s*)(["'])([^"']*)\2/gi, (m, pre: string, q: string, val: string) => {
    if (!val.trim() || isRemoteSrc(val)) return m;
    const base = basenameOf(val);
    const att = atts.find((a) => a.url && a.name.toLowerCase() === base);
    return att ? `${pre}${q}${att.url}${q}` : m;
  });
}

/** Count of src still left as local paths — images that will break in recipients' mail. */
function localSrcCount(html: string): number {
  let n = 0;
  for (const m of html.matchAll(/src\s*=\s*(["'])([^"']*)\1/gi)) {
    if (m[2].trim() && !isRemoteSrc(m[2])) n++;
  }
  return n;
}

export default function AddTemplateDialog({
  open, onClose, onSaved, editName = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Edit mode: load and fill the raw body + meta for the given name. null for new mode. */
  editName?: string | null;
}) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState("");
  const [existing, setExisting] = useState<ExistingTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // mirror for referencing the latest attachments/body when async upload completes
  const attsRef = useRef<Attachment[]>([]);
  attsRef.current = atts;
  const bodyRef = useRef("");
  bodyRef.current = body;

  // new mode — load only the existing name list for duplicate checking
  useEffect(() => {
    if (!open || editName) return;
    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => setExisting((j.templates ?? []).map((t: any) => ({ name: t.name, archived: t.archived }))))
      .catch(() => {});
  }, [open, editName]);

  // reset form on mode switch / fetch raw body + meta in edit mode
  useEffect(() => {
    if (!open) return;
    setErr(""); setFileName(""); setAtts([]);
    if (editName) {
      setName(editName);
      setLoading(true);
      fetch(`/api/templates/body?name=${encodeURIComponent(editName)}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.error) throw new Error(j.error);
          setSubject(j.subject ?? "");
          setBody(j.body ?? "");
          setDescription(j.description ?? "");
        })
        .catch((e) => setErr(e?.message ?? "불러오기 실패"))
        .finally(() => setLoading(false));
    } else {
      setName(""); setSubject(""); setBody(""); setDescription("");
    }
  }, [open, editName]);

  useEscClose(open, onClose);

  if (!open) return null;

  const trimmed = name.trim();
  // edit mode is its own name, so skip duplicate checking
  const dup = !editName && trimmed ? existing.find((t) => t.name === trimmed) : null;
  const nameInvalid = trimmed && !/^[A-Za-z0-9_-]+$/.test(trimmed);
  const nameError = nameInvalid
    ? "영문/숫자/하이픈/언더스코어만 사용 가능합니다"
    : dup
      ? `이미 같은 이름의 이메일이 있습니다${dup.archived ? " (보관함). 보관함에서 복원하거나 다른 이름을 사용하세요" : ". 다른 이름을 사용하세요"}`
      : "";

  // read a .html file and fill the body. If a full document, extract only inside <body>.
  // re-replace src with the current attachment list right after loading — works even if images are uploaded first and HTML later.
  async function loadHtmlFile(file: File) {
    setErr("");
    try {
      const text = await file.text();
      const m = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const extracted = (m ? m[1] : text).trim();
      setBody(replaceSrcs(extracted, attsRef.current));
      setFileName(file.name);
      if (!name.trim()) {
        const base = file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
        if (base) setName(base);
      }
    } catch {
      setErr("파일을 읽지 못했습니다");
    }
  }

  // upload image → issue public URL → auto-replace body src.
  async function uploadImageFile(file: File) {
    const id = `${file.name}-${Math.random().toString(36).slice(2)}`;
    // re-upload of a same-named file → replace the existing entry
    setAtts((cur) => [...cur.filter((a) => a.name.toLowerCase() !== file.name.toLowerCase()), { id, name: file.name, url: null }]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error(j.error ?? "업로드 실패");
      setAtts((cur) => {
        const next = cur.map((a) => (a.id === id ? { ...a, url: j.url as string } : a));
        // immediately re-replace the body with the latest attachment list
        setBody(replaceSrcs(bodyRef.current, next));
        return next;
      });
    } catch (e: any) {
      setAtts((cur) => cur.map((a) => (a.id === id ? { ...a, error: e?.message ?? "업로드 실패" } : a)));
    }
  }

  function onFilesPicked(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      const isHtml = /\.html?$/i.test(f.name) || f.type === "text/html";
      if (isHtml) loadHtmlFile(f);
      else if (/^image\//.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.name)) uploadImageFile(f);
      else setErr(`지원하지 않는 형식: ${f.name} — HTML 또는 PNG/JPG/GIF/WEBP(5MB 이하)만 가능합니다`);
    }
  }

  const remainingLocal = localSrcCount(body);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (remainingLocal > 0) {
      const go = window.confirm(
        `이미지 ${remainingLocal}개가 아직 로컬 경로입니다 — 수신자 메일에서 깨집니다.\n` +
        `이미지 파일을 업로드하면 같은 파일명의 src 가 자동 치환됩니다.\n\n그래도 저장할까요?`
      );
      if (!go) return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, subject, body, description, overwrite: !!editName }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "저장 실패");
      onSaved();
      onClose();
      // useEffect resets per mode on next open, so no need to reset here.
    } catch (e: any) {
      setErr(e?.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form onSubmit={submit} className="card w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-border flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="kicker">{editName ? "HTML 편집" : "HTML 직접 입력"}</div>
            <h2 className="mt-1 text-base font-semibold truncate">{editName ? `${editName} 편집` : "새 이메일 추가 (HTML)"}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text shrink-0">✕</button>
        </div>

        {loading && (
          <div className="px-5 py-2 text-[11px] text-muted border-b border-border">불러오는 중…</div>
        )}

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs text-muted mb-1.5">
              이메일 이름 <span className="text-brand">*</span>
              <span className="ml-2 text-[10px]">영문/숫자/하이픈/언더스코어만</span>
            </label>
            <input
              className={`input ${nameError ? "border-red-500/60 focus:border-red-500" : ""}`}
              required value={name}
              disabled={!!editName}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., DF-in-seoul-followup"
              pattern="[A-Za-z0-9_-]+"
            />
            {nameError && <p className="mt-1 text-[11px] text-red-500">{nameError}</p>}
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">
              이메일 제목 <span className="text-brand">*</span>
            </label>
            <input
              className="input" required value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g., [알림] 행사 D-1 안내"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">설명 (선택)</label>
            <input
              className="input" value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="언제 어떤 용도로 보내는 메일인지"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs text-muted">
                본문 HTML <span className="text-brand">*</span>
                <span className="ml-2 text-[10px] text-amber-600 font-semibold">(이미지 별도 업로드 필수!)</span>
              </label>
              <div className="flex items-center gap-2">
                {fileName && <span className="text-[10px] text-muted truncate max-w-[160px]">📄 {fileName}</span>}
                <input
                  ref={fileRef} type="file" multiple
                  accept=".html,.htm,text/html,image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => { onFilesPicked(e.target.files); e.target.value = ""; }}
                />
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost text-[11px] py-1">
                  📁 파일 업로드 (HTML·이미지)
                </button>
              </div>
            </div>
            <textarea
              className="input font-mono text-[11px] h-64 resize-y" required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder='<table>...</table>'
            />

            {/* uploaded image attachment chips */}
            {atts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {atts.map((a) => {
                  const usedCount = a.url ? body.split(a.url).length - 1 : 0;
                  return (
                    <span key={a.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface2/40 px-2 py-1 text-[11px]">
                      <span className="truncate max-w-[140px]" title={a.name}>🖼 {a.name}</span>
                      {a.error ? (
                        <span className="text-red-500" title={a.error}>실패</span>
                      ) : !a.url ? (
                        <span className="text-muted">업로드 중…</span>
                      ) : usedCount > 0 ? (
                        <span className="text-green-600" title="같은 파일명의 src 가 공개 URL 로 치환되었습니다">✓ 본문 {usedCount}곳</span>
                      ) : (
                        <span className="text-amber-600" title="본문에서 같은 파일명을 찾지 못했습니다. URL 을 복사해 직접 넣으세요.">매칭 안 됨</span>
                      )}
                      {a.url && (
                        <button
                          type="button"
                          className="text-muted hover:text-brand"
                          title="공개 URL 복사"
                          onClick={() => navigator.clipboard?.writeText(a.url!)}
                        >⧉</button>
                      )}
                      <button
                        type="button"
                        className="text-muted hover:text-red-500"
                        title="목록에서 제거 (이미 치환된 본문은 유지됩니다)"
                        onClick={() => setAtts((cur) => cur.filter((x) => x.id !== a.id))}
                      >✕</button>
                    </span>
                  );
                })}
              </div>
            )}

            {remainingLocal > 0 && (
              <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5">
                ⚠ 로컬 경로 이미지 {remainingLocal}개 — 이대로 보내면 수신자 메일에서 깨집니다. 이미지 파일을 업로드하면
                <span className="font-mono"> src</span> 가 자동 치환됩니다 (파일명 기준).
              </p>
            )}
            <p className="mt-1 text-[10px] text-muted">
              전체 HTML 문서를 올리면 {"<body>"} 안쪽만 자동으로 가져옵니다. 이미지를 함께 올리면
              본문 속 같은 파일명의 <span className="font-mono">src</span> 가 업로드된 공개 URL 로 자동 치환됩니다.
            </p>
          </div>

          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>

        <div className="p-5 border-t border-border flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">취소</button>
          <button disabled={saving || loading || !!nameError || !trimmed || !body.trim()} className="btn-primary">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
