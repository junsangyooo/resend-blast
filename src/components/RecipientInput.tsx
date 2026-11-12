"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseRecipientGrid, setNameInText, type Recipient } from "@/lib/recipients";
import type { ImportResult } from "@/lib/import-parser";

const DEFAULT_PLACEHOLDER =
  "예시)\n홍길동 hong@a.com\n홍길동, hong@a.com\n홍길동|hong@a.com\n홍길동 <hong@a.com>";

function downloadSampleCsv() {
  const csv = "email,name,company,title\nhong@example.com,홍길동,Acme,매니저\njane@example.com,Jane Doe,Acme,Director\n";
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }); // BOM: 엑셀 한글 호환
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = "recipients-sample.csv";
  a.click();
  URL.revokeObjectURL(u);
}

/* ── 지원 형식 인포 팝업 ── */
function FormatInfoModal({ onClose }: { onClose: () => void }) {
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
          {/* ① 파일 업로드 — 고정 헤더 규칙 */}
          <section>
            <div className="text-[12px] font-bold mb-2">📁 CSV / Excel 업로드 — 첫 행 헤더가 아래 이름과 정확히 일치해야 인식됩니다</div>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-[11.5px] border-collapse bg-white dark:bg-surface">
                <thead>
                  <tr className="bg-surface2/80 text-muted text-[10px]">
                    <th className="border border-border/60 py-1 px-2 font-medium text-left">헤더명</th>
                    <th className="border border-border/60 py-1 px-2 font-medium text-left">필수 여부</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-border/60 px-2 py-1 font-mono">email</td>
                    <td className="border border-border/60 px-2 py-1 text-red-500">필수 — 없으면 업로드 자체가 거부됩니다</td>
                  </tr>
                  <tr>
                    <td className="border border-border/60 px-2 py-1 font-mono">name</td>
                    <td className="border border-border/60 px-2 py-1 text-amber-600">권장 — 없으면 이름 없이 이메일만 가져옵니다</td>
                  </tr>
                  <tr>
                    <td className="border border-border/60 px-2 py-1 font-mono">company</td>
                    <td className="border border-border/60 px-2 py-1 text-muted">선택</td>
                  </tr>
                  <tr>
                    <td className="border border-border/60 px-2 py-1 font-mono">title</td>
                    <td className="border border-border/60 px-2 py-1 text-muted">선택</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted">
              대소문자는 상관없어요(<span className="font-mono">Email</span>도 인식). 다른 이름의 열은 무시됩니다.
              헤더 이름을 맞춰서 다시 올려주세요.
            </p>
          </section>

          {/* ② 직접 입력 */}
          <section>
            <div className="text-[12px] font-bold mb-2">⌨ 직접 입력 — 한 줄에 한 명, 붙여넣으면 바로 목록에 반영됩니다</div>
            <div className="input font-mono text-[12px] whitespace-pre leading-relaxed text-text/80 pointer-events-none select-text">
              {"hong@a.com\n홍길동 hong@a.com\n홍길동, hong@a.com\n홍길동|hong@a.com\n홍길동 <hong@a.com>"}
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted">엑셀·구글시트·노션 표에서 복사해 그대로 붙여넣으면 됩니다(이름/이메일만 — 회사/직함은 CSV 업로드로).</p>
          </section>

          {/* ③ 개인화 */}
          <section className="rounded-lg border border-border bg-surface2/30 px-3 py-2.5">
            <div className="text-[11px] text-text/80 leading-relaxed">
              <strong>개인화</strong> — 본문·제목에{" "}
              <code className="font-mono text-brand">{"{{name}}"}</code>·<code className="font-mono text-brand">{"{{firstName}}"}</code>·
              <code className="font-mono text-brand">{"{{company}}"}</code>·<code className="font-mono text-brand">{"{{title}}"}</code>{" "}
              를 쓰면 수신자별로 치환됩니다. 값이 없으면 빈칸이 되니{" "}
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
 * 수신자 입력 공용 컴포넌트.
 * 탭/파이프/쉼표/「이름 <이메일>」 어떤 형식이든 parseRecipientGrid 로 이름+이메일을 매핑한다.
 * CSV/Excel 업로드는 고정 헤더(email 필수, name 권장, company/title 선택)만 인식 — 컬럼 매핑 UI 없음.
 *
 * - onAdd 제공 → accumulate 모드: 붙여넣기(paste) 즉시 자동으로 onAdd 호출 후 입력을 비운다.
 *   (수동 타이핑 등 paste 가 아닌 입력은 blur 시 커밋.) CSV는 미리보기 확인 후 "N명 추가" 버튼으로 커밋.
 * - onAdd 없음 → live 모드: 입력이 바뀔 때마다 onChange(rows) 호출, 커밋 없음.
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
  /** controlled 텍스트(부모가 발송 payload 로 보관). 없으면 내부 상태 사용. */
  value?: string;
  onTextChange?: (text: string) => void;
  placeholder?: string;
  showImport?: boolean;
  /** 라벨 텍스트 — 주면 [라벨 ····· 업로드/인포] 헤더 행을 함께 렌더. */
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
  const [resultOpen, setResultOpen] = useState(false); // 인식/무시 펼침 패널
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const accumulate = typeof onAdd === "function";

  // CSV/XLSX 업로드 결과 (고정 헤더 검증 완료본 — 매핑 UI 없음)
  const [csvFileName, setCsvFileName] = useState("");
  const [csvResult, setCsvResult] = useState<ImportResult | null>(null);

  // 펼침 패널 내 이름 인라인 편집
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const parsed = useMemo(() => parseRecipientGrid(text), [text]);

  // 파싱 결과를 부모에 즉시 반영 (live·accumulate 공통).
  useEffect(() => {
    onChange?.(parsed.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  async function pickFile(file: File) {
    setImportErr("");
    setCsvResult(null);
    setImporting(true);
    try {
      // xlsx 라이브러리는 무거우므로 임포트 시점에만 로드.
      const mod = await import("@/lib/import-parser");
      const result = await mod.analyzeImportFile(file);
      setCsvFileName(file.name);
      setCsvResult(result);
    } catch (e: any) {
      setImportErr(e?.message ?? "파일을 읽지 못했습니다");
    } finally {
      setImporting(false);
    }
  }

  function confirmCsvImport() {
    if (!csvResult || !csvResult.ok || csvResult.recipients.length === 0) return;
    if (accumulate) {
      onAdd?.(csvResult.recipients);
    } else {
      // live 모드는 텍스트가 단일 소스이므로 이름/이메일만 줄로 풀어서 합류(회사/직함은 CSV 전용이라 여기선 유실).
      const lines = csvResult.recipients.map((m) => (m.name ? `${m.name}\t${m.email}` : m.email));
      setText((cur) => (cur.trim() ? `${cur.trim()}\n${lines.join("\n")}` : lines.join("\n")));
    }
    setCsvResult(null);
    setCsvFileName("");
  }
  function cancelCsvImport() {
    setCsvResult(null);
    setCsvFileName("");
  }

  function commitNameEdit() {
    if (editingEmail === null) return;
    setText(setNameInText(text, editingEmail, editingName));
    setEditingEmail(null);
    setEditingName("");
  }

  /** 텍스트박스의 현재 내용을 커밋(onAdd)하고 비운다. accumulate 모드 전용. */
  function commitFromTextarea() {
    if (!accumulate) return;
    const el = taRef.current;
    const raw = el ? el.value : text;
    const result = parseRecipientGrid(raw);
    if (result.rows.length === 0) return;
    onAdd?.(result.rows);
    setText("");
    setResultOpen(false);
  }

  function handlePaste() {
    if (!accumulate) return;
    // paste 내용이 DOM 값에 반영된 직후(다음 프레임)에 커밋 — 화면 깜빡임 없이 바로 비워진다.
    requestAnimationFrame(commitFromTextarea);
  }

  /**
   * 텍스트박스에서 포커스가 빠져나갈 때 커밋한다. 단, 포커스가 이 컴포넌트 내부의
   * 다른 요소(예: 펼침 패널의 "+ 이름 추가" 버튼)로 이동하는 경우는 커밋하지 않는다 —
   * blur 는 클릭보다 먼저 발생하므로, 여기서 그냥 커밋해버리면 패널이 통째로 사라져
   * 버튼 클릭이 씹히고 사용자가 고치려던 이름이 그대로 확정되어 버린다.
   */
  function handleBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    if (!accumulate) return;
    const related = e.relatedTarget as Node | null;
    if (related && containerRef.current?.contains(related)) return;
    commitFromTextarea();
  }

  const rows = parsed.rows;
  const namedCount = rows.filter((r) => r.name?.trim()).length;
  const ignoredCount = parsed.ignored.length;
  const dupCount = parsed.duplicates.length;

  const csvPreviewCols = useMemo(() => {
    if (!csvResult || !csvResult.ok) return [];
    const cols: { key: "name" | "company" | "title"; label: string }[] = [];
    if (csvResult.fields.name) cols.push({ key: "name", label: "이름" });
    if (csvResult.fields.company) cols.push({ key: "company", label: "회사" });
    if (csvResult.fields.title) cols.push({ key: "title", label: "직함" });
    return cols;
  }, [csvResult]);

  return (
    <div ref={containerRef} className={`space-y-2 ${className}`}>
      {/* 헤더 행: 라벨 + 업로드/인포 */}
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
        ref={taRef}
        className="input font-mono text-[12px] h-28 resize-y"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={handlePaste}
        onBlur={handleBlur}
        placeholder={placeholder ?? DEFAULT_PLACEHOLDER}
      />

      {/* 결과 칩 — 클릭하면 상세 패널 토글 */}
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

      {/* 펼침 패널 — 실패(무시)부터, 그 아래 인식 성공. 동일한 행 레이아웃에 색으로만 구분 */}
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

      {/* CSV 업로드 결과 — 에러(막힘) 또는 미리보기+확인 */}
      {csvResult && !csvResult.ok && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/[0.06] p-3 space-y-2">
          <div className="text-[12px] text-red-500 font-medium">❌ {csvResult.error}</div>
          <div className="flex justify-end">
            <button type="button" onClick={cancelCsvImport} className="btn-ghost text-xs">닫기</button>
          </div>
        </div>
      )}
      {csvResult && csvResult.ok && (
        <div className="rounded-lg border border-brand/40 bg-surface p-3 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-medium text-text/90">📄 {csvFileName}</span>
            <span className="chip text-brand">✅ {csvResult.recipients.length}명 인식됨</span>
          </div>
          {!csvResult.fields.name && (
            <div className="text-[11px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5">
              ⚠ name 열이 인식되지 않았어요 — 이름 없이 이메일만 가져옵니다.
            </div>
          )}
          {csvResult.skipped > 0 && (
            <div className="text-[11px] text-muted">이메일이 비었거나 형식이 잘못된 {csvResult.skipped}행은 제외했어요.</div>
          )}
          {csvResult.otherSheetNames.length > 0 && (
            <div className="text-[11px] text-muted">첫 번째 시트만 읽었어요 — 다른 시트({csvResult.otherSheetNames.join(", ")})는 무시됩니다.</div>
          )}
          {!accumulate && (csvResult.fields.company || csvResult.fields.title) && (
            <div className="text-[11px] text-amber-700 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5">
              ⚠ 이 입력창은 이름·이메일만 저장돼요 — 회사/직함은 리스트 만들기(멤버 추가)에서만 사용할 수 있습니다.
            </div>
          )}

          {/* 결과 미리보기 */}
          <div className="rounded border border-border bg-surface2/30 max-h-32 overflow-y-auto">
            <table className="w-full text-[11.5px]">
              <tbody>
                {csvResult.recipients.slice(0, 5).map((m, i) => (
                  <tr key={`${m.email}-${i}`} className="border-b border-border last:border-b-0">
                    <td className="px-2.5 py-1 font-mono text-text/90">{m.email}</td>
                    {csvPreviewCols.map((c) => (
                      <td key={c.key} className="px-2.5 py-1 text-muted">{m[c.key] ?? <span className="text-amber-500/80">{c.key === "name" ? "이름 없음" : "—"}</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {csvResult.recipients.length > 5 && (
              <div className="px-2.5 py-1 text-[10.5px] text-muted">… 외 {csvResult.recipients.length - 5}명</div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">{csvResult.recipients.length}명 인식</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={cancelCsvImport} className="btn-ghost text-xs">취소</button>
              <button
                type="button"
                onClick={confirmCsvImport}
                disabled={csvResult.recipients.length === 0}
                className="btn-primary text-xs px-3 py-1"
              >
                {csvResult.recipients.length}명 추가
              </button>
            </div>
          </div>
        </div>
      )}

      {infoOpen && <FormatInfoModal onClose={() => setInfoOpen(false)} />}
    </div>
  );
}
