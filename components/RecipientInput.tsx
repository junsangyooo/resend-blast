"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseRecipientGrid, setNameInText, type Recipient } from "@/lib/recipients";
import type { ColumnRole, ImportAnalysis } from "@/lib/import-parser";

const DEFAULT_PLACEHOLDER =
  "예시)\n홍길동 hong@a.com\n홍길동, hong@a.com\n홍길동|hong@a.com\n홍길동 <hong@a.com>";

const ROLE_LABELS: { value: ColumnRole; label: string }[] = [
  { value: "email", label: "이메일" },
  { value: "name", label: "이름" },
  { value: "first", label: "이름(First)" },
  { value: "last", label: "성(Last)" },
  { value: "ignore", label: "사용 안 함" },
];

function downloadSampleCsv() {
  const csv = "Email,Name\nhong@example.com,홍길동\njane@example.com,Jane Doe\n";
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }); // BOM: Excel Korean compatibility
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = "recipients-sample.csv";
  a.click();
  URL.revokeObjectURL(u);
}

/* ── Supported-format info popup — shows the accepted formats as-is in an Excel-like grid ── */
type SheetRow = { cells: string[]; head?: boolean; caption?: string };
const SHEET_EXAMPLES: SheetRow[] = [
  { caption: "기본 — Email + Name", cells: [] },
  { head: true, cells: ["Email", "Name", ""] },
  { cells: ["hong@a.com", "홍길동", ""] },
  { cells: ["jane@acme.com", "Jane Doe", ""] },
  { caption: "Full Name 도 인식", cells: [] },
  { head: true, cells: ["Email", "Full Name", ""] },
  { cells: ["kim@acme.com", "김민준", ""] },
  { caption: "First / Last 분리 — 자동 합성 (Jane Doe)", cells: [] },
  { head: true, cells: ["First Name", "Last Name", "Email"] },
  { cells: ["Jane", "Doe", "jane@acme.com"] },
  { caption: "한글 헤더 — 성+이름은 “홍길동” 으로 합성", cells: [] },
  { head: true, cells: ["성", "이름", "이메일"] },
  { cells: ["홍", "길동", "hong@a.com"] },
  { caption: "헤더 없이 데이터만 있어도 OK (이메일 위치 자동 감지)", cells: [] },
  { cells: ["lee@a.com", "이서연", ""] },
  { cells: ["park@a.com", "박지훈", ""] },
];

function FormatInfoModal({ onClose }: { onClose: () => void }) {
  let rowNo = 0;
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="kicker">Format Guide</div>
            <h3 className="text-base font-semibold mt-0.5">수신자 입력 형식</h3>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="닫기">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ① File upload — Excel grid preview */}
          <section>
            <div className="text-[12px] font-bold mb-2">📁 CSV / Excel 업로드 — 이런 시트가 모두 인식됩니다</div>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-[11.5px] border-collapse bg-white dark:bg-surface">
                <thead>
                  <tr className="bg-surface2/80 text-muted text-[10px]">
                    <th className="w-8 border border-border/60 py-1 font-medium"></th>
                    <th className="border border-border/60 py-1 font-medium">A</th>
                    <th className="border border-border/60 py-1 font-medium">B</th>
                    <th className="border border-border/60 py-1 font-medium">C</th>
                  </tr>
                </thead>
                <tbody>
                  {SHEET_EXAMPLES.map((r, i) => {
                    if (r.caption !== undefined && r.cells.length === 0) {
                      return (
                        <tr key={i} className="bg-brand/[0.06]">
                          <td className="border border-border/60" />
                          <td colSpan={3} className="border border-border/60 px-2 py-1 text-[10.5px] text-brand font-semibold">{r.caption}</td>
                        </tr>
                      );
                    }
                    rowNo += 1;
                    return (
                      <tr key={i} className={r.head ? "bg-surface2/50" : ""}>
                        <td className="border border-border/60 text-center text-[10px] text-muted bg-surface2/50">{rowNo}</td>
                        {[0, 1, 2].map((c) => (
                          <td key={c} className={`border border-border/60 px-2 py-1 font-mono text-[11px] ${r.head ? "font-bold text-text/80" : "text-text/90"}`}>
                            {r.cells[c] ?? ""}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted">업로드 후 컬럼 매핑을 직접 확인·수정할 수 있어요. 시트가 여러 개면 선택 가능.</p>
          </section>

          {/* ② Direct entry — same look as the input field */}
          <section>
            <div className="text-[12px] font-bold mb-2">⌨ 직접 입력 — 한 줄에 한 명, 아래처럼 그대로 치면 됩니다</div>
            <div className="input font-mono text-[12px] whitespace-pre leading-relaxed text-text/80 pointer-events-none select-text">
              {"hong@a.com\n홍길동 hong@a.com\n홍길동, hong@a.com\n홍길동|hong@a.com\n홍길동 <hong@a.com>"}
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted">엑셀·구글시트·노션 표에서 복사해 그대로 붙여넣어도 됩니다.</p>
          </section>

          {/* ③ Personalization */}
          <section className="rounded-lg border border-border bg-surface2/30 px-3 py-2.5">
            <div className="text-[11px] text-text/80 leading-relaxed">
              <strong>개인화</strong> — 이름이 매핑된 수신자는 본문·제목의{" "}
              <code className="font-mono text-brand">{"{{name}}"}</code>·<code className="font-mono text-brand">{"{{firstName}}"}</code>{" "}
              자리에 이름이 들어갑니다. 이름이 없으면 빈칸이 되니{" "}
              <code className="font-mono text-brand">{"{{name|친구}}"}</code> 처럼 기본값을 둘 수 있어요.
            </div>
          </section>
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-between items-center shrink-0">
          <button type="button" onClick={downloadSampleCsv} className="chip hover:border-brand/40">⬇ 예시 CSV 다운로드</button>
          <button type="button" onClick={onClose} className="btn-ghost text-sm">닫기</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared recipient-input component.
 * Maps name+email from any format (tab/pipe/comma/「Name <email>」) via parseRecipientGrid,
 * and the recognized/ignored chips (toggle) let you expand the result. CSV/Excel uploads join in after a column-mapping confirmation step.
 *
 * - onAdd provided → accumulate mode: shows an "add" button; on click, passes rows then clears the input.
 * - onAdd absent → live mode: calls onChange(rows) every time the input changes.
 */
export default function RecipientInput({
  onAdd,
  onChange,
  value,
  onTextChange,
  placeholder,
  showImport = true,
  label,
  className = "",
}: {
  onAdd?: (rows: Recipient[]) => void;
  onChange?: (rows: Recipient[]) => void;
  /** Controlled text (parent keeps it as the send payload). Falls back to internal state if absent. */
  value?: string;
  onTextChange?: (text: string) => void;
  placeholder?: string;
  showImport?: boolean;
  /** Label text — if given, also renders the [label ····· upload/info] header row. */
  label?: string;
  className?: string;
}) {
  const [internalText, setInternalText] = useState("");
  const controlled = value !== undefined;
  const text = controlled ? value : internalText;
  const setText = (next: string | ((cur: string) => string)) => {
    const resolved = typeof next === "function" ? next(text) : next;
    if (controlled) onTextChange?.(resolved);
    else setInternalText(resolved);
  };
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false); // recognized/ignored expand panel
  const fileRef = useRef<HTMLInputElement>(null);
  const accumulate = typeof onAdd === "function";

  // CSV/XLSX upload → column-mapping confirmation step
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null); // null = follow auto-inference
  const [buildFns, setBuildFns] = useState<null | typeof import("@/lib/import-parser")>(null);

  // Inline name editing within the expand panel
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const parsed = useMemo(() => parseRecipientGrid(text), [text]);

  // Reflect parse results to the parent immediately (common to live and accumulate).
  useEffect(() => {
    onChange?.(parsed.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  async function pickFile(file: File, sheetName?: string) {
    setImportErr("");
    setImporting(true);
    try {
      // The xlsx library is heavy, so load it only at import time.
      const mod = await import("@/lib/import-parser");
      const a = await mod.analyzeImportFile(file, sheetName);
      if (a.grid.length === 0) {
        setImportErr("파일에서 데이터를 찾지 못했습니다");
        return;
      }
      setBuildFns(mod);
      setPendingFile(file);
      setAnalysis(a);
      setRoles(a.roles);
      setHeaderOverride(null);
    } catch (e: any) {
      setImportErr(e?.message ?? "파일을 읽지 못했습니다");
    } finally {
      setImporting(false);
    }
  }

  // Live result of the mapping confirmation panel — the user can correct whether a header exists (recovers from auto-inference mistakes)
  const effectiveHeader = headerOverride ?? analysis?.hasHeader ?? false;
  const pendingReport = useMemo(() => {
    if (!analysis || !buildFns) return null;
    return buildFns.buildRecipients({ ...analysis, hasHeader: effectiveHeader }, roles);
  }, [analysis, roles, buildFns, effectiveHeader]);
  const effectiveLabels = useMemo(() => {
    if (!analysis) return [];
    if (effectiveHeader === analysis.hasHeader) return analysis.columnLabels;
    const first = analysis.grid[0] ?? [];
    return analysis.columnLabels.map((_, c) => (effectiveHeader ? (first[c]?.trim() || `열 ${c + 1}`) : `열 ${c + 1}`));
  }, [analysis, effectiveHeader]);

  function confirmImport() {
    if (!pendingReport) return;
    const lines = pendingReport.rows.map((m) => (m.name ? `${m.name}\t${m.email}` : m.email));
    setText((cur) => (cur.trim() ? `${cur.trim()}\n${lines.join("\n")}` : lines.join("\n")));
    if (pendingReport.errors.length > 0) {
      setImportErr(`${pendingReport.rows.length}명 추가 · ${pendingReport.errors.length}개 행이 형식 오류로 제외됨 (예: ${pendingReport.errors[0]?.reason})`);
    }
    cancelImport();
  }
  function cancelImport() {
    setPendingFile(null);
    setAnalysis(null);
    setRoles([]);
  }

  function commitNameEdit() {
    if (editingEmail === null) return;
    setText(setNameInText(text, editingEmail, editingName));
    setEditingEmail(null);
    setEditingName("");
  }

  function add() {
    if (parsed.rows.length === 0) return;
    onAdd?.(parsed.rows);
    setText("");
    setResultOpen(false);
  }

  const rows = parsed.rows;
  const namedCount = rows.filter((r) => r.name?.trim()).length;
  const ignoredCount = parsed.ignored.length;
  const dupCount = parsed.duplicates.length;
  const hasFirstLast = roles.includes("first") && roles.includes("last");

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header row: label + upload/info */}
      {(label || showImport) && (
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-muted">{label ?? ""}</label>
          {showImport && (
            <div className="flex items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                className="chip hover:border-brand/40"
              >
                {importing ? "읽는 중…" : "📁 CSV/Excel 업로드"}
              </button>
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className="w-[22px] h-[22px] rounded-full border border-border text-muted hover:text-brand hover:border-brand/40 text-[11px] font-bold leading-none"
                title="지원 형식 안내"
                aria-label="지원 형식 안내"
              >!</button>
            </div>
          )}
        </div>
      )}

      <textarea
        className="input font-mono text-[12px] h-28 resize-y"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? DEFAULT_PLACEHOLDER}
      />

      {/* Result chips — click to toggle the detail panel */}
      {(rows.length > 0 || ignoredCount > 0 || dupCount > 0) && (
        <div className="flex items-center flex-wrap gap-1.5">
          {rows.length > 0 && (
            <button type="button" onClick={() => setResultOpen((o) => !o)} className="chip text-brand hover:border-brand/40" title="클릭해서 인식된 수신자 보기">
              ✅ {rows.length}명 인식{namedCount > 0 ? ` · 이름 ${namedCount}` : ""} {resultOpen ? "▾" : "▸"}
            </button>
          )}
          {ignoredCount > 0 && (
            <button type="button" onClick={() => setResultOpen((o) => !o)} className="chip text-red-500 hover:border-red-400/60" title="클릭해서 무시된 줄 보기">
              ⚠ {ignoredCount}줄 무시 {resultOpen ? "▾" : "▸"}
            </button>
          )}
          {dupCount > 0 && <span className="chip text-yellow-500">중복 {dupCount} 제거</span>}
        </div>
      )}

      {/* Expand panel — failed (ignored) first, then recognized below. Same row layout, distinguished only by color */}
      {resultOpen && (rows.length > 0 || ignoredCount > 0) && (
        <div className="rounded-lg border border-border bg-surface max-h-56 overflow-y-auto">
          <table className="w-full text-[12px]">
            <tbody>
              {parsed.ignored.map((g, i) => (
                <tr key={`ig-${i}`} className="border-b border-border/60 bg-red-500/[0.06]">
                  <td className="px-3 py-1.5 w-5 text-red-500 text-[11px]">✗</td>
                  <td className="px-1 py-1.5 font-mono text-text/80 truncate w-full max-w-0" title={g.line}>{g.line}</td>
                  <td className="px-3 py-1.5 text-right text-red-500/90 text-[11px] whitespace-nowrap" title={g.reason}>{g.reason}</td>
                </tr>
              ))}
              {rows.map((m, i) => {
                const nameless = !m.name?.trim();
                const editing = editingEmail === m.email;
                return (
                  <tr key={`${m.email}-${i}`} className={`border-b border-border/60 last:border-b-0 ${nameless ? "bg-amber-500/[0.06]" : "bg-green-500/[0.04]"}`}>
                    <td className="px-3 py-1.5 w-5 text-green-600 text-[11px]">✓</td>
                    <td className="px-1 py-1.5 text-text/90 font-mono">{m.email}</td>
                    <td className="px-3 py-1.5 text-muted">
                      {editing ? (
                        <input
                          autoFocus
                          className="input text-[12px] py-0.5 px-1.5 w-full max-w-[160px]"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={commitNameEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitNameEdit();
                            if (e.key === "Escape") { e.stopPropagation(); setEditingEmail(null); setEditingName(""); }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`text-left w-full hover:underline decoration-dotted ${nameless ? "text-amber-500/80" : ""}`}
                          title="클릭해서 이름 수정"
                          onClick={() => { setEditingEmail(m.email); setEditingName(m.name ?? ""); }}
                        >
                          {m.name?.trim() || "+ 이름 추가"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {importErr && (
        <div className="text-[11px] text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">{importErr}</div>
      )}

      {/* Import column-mapping confirmation panel */}
      {analysis && pendingReport && (
        <div className="rounded-lg border border-brand/40 bg-surface p-3 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-medium text-text/90">📄 {analysis.fileName}</span>
            {analysis.sheetNames.length > 1 && (
              <select
                className="input text-[11px] py-0.5 px-1.5 w-auto"
                value={analysis.sheetName}
                onChange={(e) => pendingFile && pickFile(pendingFile, e.target.value)}
              >
                {analysis.sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <label className="text-[11px] text-muted flex items-center gap-1 cursor-pointer" title="첫 행이 데이터인데 헤더로 잘못 인식됐다면 체크를 해제하세요">
              <input
                type="checkbox"
                checked={effectiveHeader}
                onChange={(e) => setHeaderOverride(e.target.checked)}
              />
              첫 행은 헤더 (수신자 아님)
            </label>
          </div>

          {/* Column role mapping */}
          <div className="flex flex-wrap gap-2">
            {effectiveLabels.map((label2, c) => (
              <div key={c} className="flex items-center gap-1.5 rounded border border-border bg-surface2/40 px-2 py-1">
                <span className="text-[11px] text-text/80 max-w-[110px] truncate" title={label2}>{label2}</span>
                <select
                  className="input text-[11px] py-0.5 px-1 w-auto"
                  value={roles[c] ?? "ignore"}
                  onChange={(e) => {
                    const next = [...roles];
                    const v = e.target.value as ColumnRole;
                    // Only one column may have the email role
                    if (v === "email") for (let i = 0; i < next.length; i++) if (next[i] === "email") next[i] = "ignore";
                    next[c] = v;
                    setRoles(next);
                  }}
                >
                  {ROLE_LABELS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            ))}
            {hasFirstLast && (
              <button
                type="button"
                className="chip hover:border-brand/40"
                title="성(Last) 컬럼을 무시하고 First 만 이름으로 사용"
                onClick={() => setRoles(roles.map((r) => (r === "last" ? "ignore" : r)))}
              >
                First만 사용
              </button>
            )}
          </div>

          {/* Result preview */}
          <div className="rounded border border-border bg-surface2/30 max-h-32 overflow-y-auto">
            <table className="w-full text-[11.5px]">
              <tbody>
                {pendingReport.rows.slice(0, 5).map((m, i) => (
                  <tr key={`${m.email}-${i}`} className="border-b border-border last:border-b-0">
                    <td className="px-2.5 py-1 font-mono text-text/90">{m.email}</td>
                    <td className="px-2.5 py-1 text-muted">{m.name ?? <span className="text-amber-500/80">이름 없음</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pendingReport.rows.length > 5 && (
              <div className="px-2.5 py-1 text-[10.5px] text-muted">… 외 {pendingReport.rows.length - 5}명</div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">
              {pendingReport.rows.length}명 인식
              {pendingReport.errors.length > 0 ? ` · ${pendingReport.errors.length}행 형식 오류 제외` : ""}
            </span>
            <div className="flex gap-1.5">
              <button type="button" onClick={cancelImport} className="btn-ghost text-xs">취소</button>
              <button
                type="button"
                onClick={confirmImport}
                disabled={pendingReport.rows.length === 0}
                className="btn-primary text-xs px-3 py-1"
              >
                {pendingReport.rows.length}명 추가
              </button>
            </div>
          </div>
        </div>
      )}

      {accumulate && (
        <div className="flex justify-end">
          <button type="button" onClick={add} disabled={rows.length === 0} className="btn-ghost text-xs">
            {rows.length > 0 ? `${rows.length}명 추가` : "텍스트에서 멤버 추가"}
          </button>
        </div>
      )}

      {infoOpen && <FormatInfoModal onClose={() => setInfoOpen(false)} />}
    </div>
  );
}
