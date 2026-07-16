// lib/ai/examples.ts — few-shot 예시 spec — 프리셋(행사 초청 / D-1 리마인더)과 동일 구성. 고정 id.
import type { TemplateSpec } from "../blocks";
import { brand } from "../../brand.config";

const CO = brand.identity.companyName;

export const EXAMPLE_SPECS: { label: string; spec: TemplateSpec }[] = [
  { label: "행사 초청", spec: {
    subject: `[초청] ${CO} Demo Day`, preheader: "서울에서 열리는 첫 공개 데모",
    showLogo: true, showFooter: true, footer: { showSocial: true, showUnsubscribe: true },
    blocks: [
      { id: "ex1", type: "kicker", text: "YOU'RE INVITED" },
      { id: "ex2", type: "heading", text: `${CO} Demo Day`, size: "L" },
      { id: "ex3", type: "badge", line1: "2026. 6. 10 (화) 오후 4시", line2: "라움아트센터, 서울" },
      { id: "ex4", type: "text", html: `{{name|Roboticist}}님을 ${CO}의 첫 공개 데모데이에 초대합니다.<br>현장에서 라이브 데모와 네트워킹이 준비되어 있습니다.` },
      { id: "ex5", type: "button", label: "참가 신청하기", url: "https://example.com/rsvp", arrow: false },
      { id: "ex6", type: "divider", gap: "lg" },
      { id: "ex7", type: "text", size: "S", color: "muted", align: "center", html: "좌석이 한정되어 있어 선착순으로 마감됩니다." },
    ],
  }},
  { label: "D-1 리마인더", spec: {
    subject: "[D-1] 내일 행사 안내", preheader: "내일 오후 4시, 라움아트센터",
    showLogo: true, showFooter: true, footer: { showSocial: true, showUnsubscribe: true },
    blocks: [
      { id: "ex1", type: "kicker", text: "REMINDER · D-1" },
      { id: "ex2", type: "heading", text: "내일 뵙겠습니다 👋" },
      { id: "ex3", type: "text", html: "{{firstName|게스트}}님, 신청하신 행사가 <strong>내일</strong>입니다." },
      { id: "ex4", type: "badge", line1: "오후 4시 시작 · 3시 30분부터 입장", line2: "라움아트센터, 서울" },
      { id: "ex5", type: "agenda", title: "Agenda", rows: [
        { time: "3:30 PM", label: "등록·네트워킹" }, { time: "4:00 PM", label: "키노트" }, { time: "5:00 PM", label: "라이브 데모" },
      ]},
      { id: "ex6", type: "button", label: "오시는 길", url: "https://example.com/map", arrow: false },
    ],
  }},
];
