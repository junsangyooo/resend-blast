"use client";
import { ZONE_LABEL, ZONE_UTC } from "@/lib/kst";

export type KstValue = { date: string; time: string };

/**
 * Date + time input, always in the schedule zone (brand.config schedule) — the zone is fixed text right next to the fields.
 * Conversion to the absolute instant happens in lib/kst (independent of server/browser zone).
 */
export default function KstDateTimeInput({ value, onChange }: {
  value: KstValue;
  onChange: (v: KstValue) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        className="input py-1.5 px-2 text-[13px] min-w-[128px] flex-1"
        value={value.date}
        onChange={(e) => onChange({ ...value, date: e.target.value })}
      />
      <input
        type="time"
        step={60}
        className="input py-1.5 px-2 text-[13px] w-[114px] shrink-0"
        value={value.time}
        onChange={(e) => onChange({ ...value, time: e.target.value })}
      />
      <span className="text-[13px] font-semibold text-text/80 shrink-0" title={ZONE_UTC}>{ZONE_LABEL}</span>
    </div>
  );
}
