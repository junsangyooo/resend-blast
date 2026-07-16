"use client";
// 스튜디오 블록 조립기 — 자유도 축소판: 문구·순서·추가삭제만.
// 스타일 토큰(align/size/color/…)은 UI 미노출 (spec 에는 유지, AI 만 조작).
import { useRef, useState } from "react";
import { type Block, type BlockType, BLOCK_PALETTE, emptyBlock } from "@/lib/blocks";
import { RichText } from "./RichText";

const TLAB: Record<BlockType, string> = {
  heading: "제목", text: "본문", button: "버튼", badge: "날짜 배지", kicker: "작은 라벨",
  numbered: "번호 목록", agenda: "어젠다 표", grid: "그리드", image: "이미지", divider: "구분선",
};

async function uploadImage(file: File): Promise<string | null> {
  const fd = new FormData(); fd.append("file", file);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  const j = await r.json();
  return r.ok && j.url ? j.url : null;
}
function pickImage(cb: (url: string) => void) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/png,image/jpeg,image/gif,image/webp";
  inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const u = await uploadImage(f); if (u) cb(u); };
  inp.click();
}

export default function BlockList({ blocks, onChange, changedIds }: {
  blocks: Block[]; onChange: (b: Block[]) => void; changedIds: Set<string>;
}) {
  const [addAt, setAddAt] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const patch = (id: string, p: Partial<Block>) => onChange(blocks.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));
  const insert = (type: BlockType, at: number) => { const c = [...blocks]; c.splice(at, 0, emptyBlock(type)); onChange(c); setAddAt(null); };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const c = [...blocks]; const [b] = c.splice(from, 1); c.splice(to, 0, b); onChange(c);
  };
  const patchArr = (id: string, key: "items" | "rows" | "cards", i: number, p: any) =>
    patch(id, { [key]: (blocks.find((b) => b.id === id) as any)[key].map((x: any, j: number) => (j === i ? { ...x, ...p } : x)) } as any);
  const addArr = (id: string, key: "items" | "rows" | "cards", seed: any) =>
    patch(id, { [key]: [ ...(((blocks.find((b) => b.id === id) as any)[key]) ?? []), seed ] } as any);
  const delArr = (id: string, key: "items" | "rows" | "cards", i: number) =>
    patch(id, { [key]: ((blocks.find((b) => b.id === id) as any)[key] ?? []).filter((_: any, j: number) => j !== i) } as any);

  return (
    <div className="space-y-1.5" onDragOver={(e) => e.preventDefault()}>
      <AddSlot at={0} addAt={addAt} setAddAt={setAddAt} insert={insert} />
      {blocks.map((b, i) => (
        <div key={b.id}>
          <div
            draggable
            onDragStart={() => { dragIdx.current = i; }}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
            onDrop={() => { if (dragIdx.current !== null) move(dragIdx.current, i); dragIdx.current = null; setOverIdx(null); }}
            onDragEnd={() => { dragIdx.current = null; setOverIdx(null); }}
            className={`group rounded-xl border bg-surface px-3 py-2.5 transition
              ${overIdx === i ? "border-brand" : "border-border"}
              ${changedIds.has(b.id) ? "ring-2 ring-brand/50" : ""}`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="cursor-grab text-muted/60 select-none" title="드래그로 이동">⠿</span>
              <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">{TLAB[b.type]}</span>
              {changedIds.has(b.id) && <span className="text-[10px] text-brand font-semibold">AI 변경</span>}
              <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button className="icon-btn" title="위로" onClick={() => move(i, i - 1)}>↑</button>
                <button className="icon-btn" title="아래로" onClick={() => move(i, i + 1)}>↓</button>
                <button className="icon-btn text-muted hover:text-red-500" title="삭제" onClick={() => remove(b.id)}>✕</button>
              </span>
            </div>
            <BlockFields b={b} patch={(p) => patch(b.id, p)}
              patchArr={(k, j, p) => patchArr(b.id, k, j, p)} addArr={(k, s) => addArr(b.id, k, s)} delArr={(k, j) => delArr(b.id, k, j)} />
          </div>
          <AddSlot at={i + 1} addAt={addAt} setAddAt={setAddAt} insert={insert} />
        </div>
      ))}
      {blocks.length === 0 && (
        <p className="text-xs text-muted text-center py-6">아직 블록이 없습니다 — 왼쪽 채팅으로 생성하거나 + 로 직접 추가하세요.</p>
      )}
    </div>
  );
}

function AddSlot({ at, addAt, setAddAt, insert }: {
  at: number; addAt: number | null; setAddAt: (v: number | null) => void; insert: (t: BlockType, at: number) => void;
}) {
  return (
    <div className="relative h-3 group/slot">
      <button className="absolute inset-x-0 -top-1 h-5 flex items-center justify-center opacity-0 group-hover/slot:opacity-100 transition text-[11px] text-brand"
        onClick={() => setAddAt(addAt === at ? null : at)}>＋ 블록 추가</button>
      {addAt === at && (
        <div className="absolute z-20 left-1/2 -translate-x-1/2 top-4 grid grid-cols-5 gap-1 rounded-xl border border-border bg-surface shadow-lg p-2 w-72">
          {BLOCK_PALETTE.map((p) => (
            <button key={p.type} className="rounded-lg px-1 py-1.5 text-[11px] hover:bg-surface2" title={p.hint}
              onClick={() => insert(p.type, at)}>{p.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* 타입별 필드 — 문장형은 RichText(부분서식), 한 줄 제목류는 input(평문) */
function BlockFields({ b, patch, patchArr, addArr, delArr }: {
  b: Block; patch: (p: Partial<Block>) => void;
  patchArr: (k: "items" | "rows" | "cards", i: number, p: any) => void;
  addArr: (k: "items" | "rows" | "cards", seed: any) => void;
  delArr: (k: "items" | "rows" | "cards", i: number) => void;
}) {
  const inp = "input text-[13px] py-1.5";
  switch (b.type) {
    case "divider": return <p className="text-[11px] text-muted">— 구분선 —</p>;
    case "kicker": return <input className={inp} value={b.text ?? ""} placeholder="작은 라벨 (예: YOU'RE INVITED)" onChange={(e) => patch({ text: e.target.value })} />;
    case "heading": return (<div className="space-y-1.5">
      <input className={`${inp} font-semibold`} value={b.text ?? ""} placeholder="제목" onChange={(e) => patch({ text: e.target.value })} />
      {b.subnote !== undefined && <input className={inp} value={b.subnote} placeholder="부제 코멘트" onChange={(e) => patch({ subnote: e.target.value })} />}
    </div>);
    case "text": return <RichText value={b.html ?? ""} placeholder="본문 — 드래그하면 서식 툴바" onCommit={(h) => patch({ html: h })} className="text-[13px] leading-relaxed border border-border rounded-lg px-2.5 py-2" />;
    case "button": return (<div className="grid grid-cols-2 gap-1.5">
      <input className={inp} value={b.label ?? ""} placeholder="버튼 문구" onChange={(e) => patch({ label: e.target.value })} />
      <input className={inp} value={b.url ?? ""} placeholder="https://…" onChange={(e) => patch({ url: e.target.value })} />
    </div>);
    case "badge": return (<div className="space-y-1.5">
      <input className={inp} value={b.line1 ?? ""} placeholder="첫 줄 (예: 6. 10 (화) 오후 4시)" onChange={(e) => patch({ line1: e.target.value })} />
      <input className={inp} value={b.line2 ?? ""} placeholder="둘째 줄 (예: 장소)" onChange={(e) => patch({ line2: e.target.value })} />
    </div>);
    case "numbered": return (<div className="space-y-1.5">
      {b.title !== undefined && <input className={inp} value={b.title} placeholder="목록 제목" onChange={(e) => patch({ title: e.target.value })} />}
      {(b.items ?? []).map((it, i) => (
        <div key={i} className="flex gap-1.5 items-start">
          <span className="text-[11px] text-brand font-mono pt-2">{String(i + 1).padStart(2, "0")}</span>
          <div className="flex-1 space-y-1">
            <input className={inp} value={it.title} placeholder="항목 제목" onChange={(e) => patchArr("items", i, { title: e.target.value })} />
            <RichText value={it.descHtml ?? it.desc ?? ""} placeholder="설명 (선택)" onCommit={(h) => patchArr("items", i, { descHtml: h, desc: undefined })} className="text-[12px] border border-border rounded-lg px-2 py-1.5" />
          </div>
          <button className="icon-btn text-muted hover:text-red-500 mt-1" onClick={() => delArr("items", i)}>✕</button>
        </div>
      ))}
      <button className="btn-ghost text-[11px] py-1" onClick={() => addArr("items", { title: "" })}>＋ 항목</button>
    </div>);
    case "agenda": return (<div className="space-y-1.5">
      {b.title !== undefined && <input className={inp} value={b.title} placeholder="표 제목" onChange={(e) => patch({ title: e.target.value })} />}
      {(b.rows ?? []).map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <input className={`${inp} w-28 font-mono`} value={r.time} placeholder="4:00 PM" onChange={(e) => patchArr("rows", i, { time: e.target.value })} />
          <input className={`${inp} flex-1`} value={r.label} placeholder="내용" onChange={(e) => patchArr("rows", i, { label: e.target.value })} />
          <button className="icon-btn text-muted hover:text-red-500" onClick={() => delArr("rows", i)}>✕</button>
        </div>
      ))}
      <button className="btn-ghost text-[11px] py-1" onClick={() => addArr("rows", { time: "", label: "" })}>＋ 행</button>
    </div>);
    case "image": return (<div className="space-y-1.5">
      {b.url
        ? <div className="relative group/img"><img src={b.url} alt={b.alt ?? ""} className="rounded-lg max-h-40 w-auto" />
            <button className="absolute top-1 right-1 btn-ghost text-[11px] py-0.5 opacity-0 group-hover/img:opacity-100" onClick={() => pickImage((u) => patch({ url: u }))}>교체</button></div>
        : <button className="btn-ghost text-[12px] w-full py-4 border-dashed" onClick={() => pickImage((u) => patch({ url: u }))}>🖼 이미지 업로드</button>}
      <input className={inp} value={b.caption ?? ""} placeholder="하단 캡션 (선택)" onChange={(e) => patch({ caption: e.target.value })} />
    </div>);
    case "grid": return (<div className="space-y-1.5">
      {(b.cards ?? []).map((c, i) => (
        <div key={i} className="rounded-lg border border-border p-2 space-y-1">
          <div className="flex gap-1.5">
            {b.cardType === "stat" && <input className={`${inp} w-24 font-mono`} value={c.value ?? ""} placeholder="120+" onChange={(e) => patchArr("cards", i, { value: e.target.value })} />}
            <input className={`${inp} flex-1`} value={c.title ?? ""} placeholder="카드 제목" onChange={(e) => patchArr("cards", i, { title: e.target.value })} />
            <button className="icon-btn text-muted hover:text-red-500" onClick={() => delArr("cards", i)}>✕</button>
          </div>
          {b.cardType !== "stat" && (
            <RichText value={c.descHtml ?? c.desc ?? ""} placeholder="카드 설명" onCommit={(h) => patchArr("cards", i, { descHtml: h, desc: undefined })} className="text-[12px] border border-border rounded-lg px-2 py-1.5" />
          )}
          {b.cardType === "image" && (c.img
            ? <img src={c.img} alt="" className="rounded max-h-24" />
            : <button className="btn-ghost text-[11px] py-1.5 w-full border-dashed" onClick={() => pickImage((u) => patchArr("cards", i, { img: u }))}>이미지 업로드</button>)}
        </div>
      ))}
      <button className="btn-ghost text-[11px] py-1" onClick={() => addArr("cards", b.cardType === "stat" ? { value: "", title: "" } : { title: "", desc: "" })}>＋ 카드</button>
    </div>);
    default: return null;
  }
}
