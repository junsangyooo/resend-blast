"use client";

const GUIDE: { dot: string; label: string; desc: string }[] = [
  { dot: "bg-yellow-500", label: "Sent", desc: "Resend가 수신 서버로 넘긴 상태(전송 중). 도착은 아직 미확정." },
  { dot: "bg-green-500", label: "Delivered", desc: "수신 서버가 수락 — 받은편지함 도착 확정." },
  { dot: "bg-red-500", label: "Bounced", desc: "수신 서버가 거부 — 전달 실패(잘못된 주소·메일함 꽉참·차단). 도착 안 함." },
  { dot: "bg-blue-500", label: "Opened", desc: "수신자가 메일을 열어봄." },
  { dot: "bg-purple-500", label: "Clicked", desc: "메일 안 링크를 클릭함." },
  { dot: "bg-orange-500", label: "Complained", desc: "수신자가 스팸으로 신고함." },
];

export default function StatusGuide({ open }: { open: boolean }) {
  if (!open) return null;
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface2/50 p-3 space-y-2">
      {GUIDE.map((g) => (
        <div key={g.label} className="flex gap-2 text-[11px] leading-relaxed">
          <span className={`w-2 h-2 rounded-full ${g.dot} shrink-0 mt-1`} />
          <div>
            <span className="text-text/90 font-semibold">{g.label}</span>
            <span className="text-muted"> — {g.desc}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
