# Email Blast — 전사 배포 준비 작업 내역

이 문서는 "사내 누구나 셀프서비스로 쓰는 일괄 발송 도구"로 정식 배포하기 위해 수행한 개선과,
**배포 전에 사용자가 직접 해야 하는 설정**을 정리한다. (감사 80건 중 P1 전체 + 핵심 P2/P3 반영)

검증: `npm test` 38개 통과 · `npm run build` 성공 · `npx tsc --noEmit` 클린.

---

## 1. 무엇이 바뀌었나 (영역별)

### 보안
- **저장형 XSS 차단**: 미리보기/HTML 서빙 라우트(`/api/templates?preview=`)에 `Content-Security-Policy: sandbox` + `nosniff` 부여 → 새 탭/다운로드로 열어도 스크립트 실행 불가. (`app/api/templates/route.ts`)
- **전역 보안 헤더**: `next.config.js` 에 nosniff·X-Frame-Options(SAMEORIGIN)·Referrer-Policy·HSTS·Permissions-Policy.
- **권한 모델 도입**: 리스트/템플릿 수정·삭제는 **생성자 또는 관리자(`ADMIN_EMAILS`)만**. 레거시(생성자 미기록)는 잠그지 않음. (`lib/config.ts`의 `canManage`, `lib/lists.ts`, `lib/templates.ts`, 각 라우트)
- **import 라우트 인증**: 리스트 임포트가 actor 검증 + 소유자 체크 + 5만 명 상한. (`app/api/lists/[slug]/import/route.ts`)
- **발송 남용 방지**: 1회 수신자 상한(`MAX_RECIPIENTS_PER_SEND`, 기본 1000), 사용자 시간당·일일 발송 한도, **전역 발송 스로틀**(동시 발송도 Resend 초당 5건 한도 안 넘게), 발송 간격 150→220ms. (`app/api/send/route.ts`, `lib/send-guards.ts`, `lib/config.ts`)
- **멱등성**: 90초 내 동일 내용(보낸이+제목+수신자집합) 재발송 차단(더블클릭 방지).
- **입력 크기 가드**: 템플릿 블록 ≤100, 임포트 ≤5만.

### 컴플라이언스 / 전달성
- **수신거부(Unsubscribe)**: 발송 시 `List-Unsubscribe` + `List-Unsubscribe-Post`(RFC 8058 원클릭) 헤더 주입 + 본문 푸터에 서명된 수신거부 링크. 공개 라우트 `/api/unsubscribe`(GET 확인페이지 → POST 처리)로 억제목록 등록. (`lib/unsubscribe.ts`, `app/api/unsubscribe/route.ts`, `lib/blocks.ts`)
- **억제목록(suppression)**: 수신거부·반송·스팸신고 주소를 `data/suppression.json` 에 저장 → **다음 발송에서 자동 제외**. Resend webhook 의 bounced/complained 도 자동 등록. (`lib/suppression.ts`)
- **정보통신망법 (광고)**: 발송 화면 "광고성 메일" 체크 시 제목에 `(광고)` 자동 접두 + 푸터에 전송자 명칭·연락처·수신거부 방법 표기. (이메일은 야간 전송 별도 동의 면제 — 시각 제약 없음)
- **CAN-SPAM**: 푸터에 발신자 우편주소(`SENDER_POSTAL_ADDRESS`) 표기 옵션(해외 수신자용).
- **Outlook 호환**: `rgba()` → 흰 배경 합성 hex, 버튼/배지에 `bgcolor` 속성, 카피라이트 연도 동적(`new Date().getFullYear()`).

### 트래킹 / 팔로업
- **Resend webhook 수신**: `/api/webhooks/resend`(Svix 서명 검증). open/click/bounce/complaint 를 발송 레코드에 **영속**(Resend 30일 보존 한계 대비) + 반송/신고 자동 억제. (`app/api/webhooks/resend/route.ts`)
- **라이브 상태 영속**: 'Resend 상태 조회'로 가져온 상태도 레코드에 저장.
- **성과 지표**: 상세 모달에 발송/전달/열람률/클릭률 + 반송·스팸신고 카운트. (`lib/send-log.ts`의 `computeMetrics`)
- **팔로업 액션**: 상세 모달에서 **"실패자 재발송" / "미열람자 리마인더"** → 대상 이메일을 발송 화면에 prefill. + **CSV 내보내기**, 실패/전체 복사 버튼. (`components/TrackingSidebar.tsx`, `app/page.tsx`)

### 목적 적합성 (셀프서비스 범용화)
- **발신자 다중화**: 내장 + `data/from.json`(관리자가 UI/API로 추가). 발송 화면에 발신자 선택 + **Reply-To 입력**. (`lib/senders.ts`, `app/api/from/route.ts`, `app/api/config/route.ts`, `components/SendForm.tsx`)
- **개인화**: 본문 `{{name}}` / `{{email}}` 토큰을 수신자별 치환(값도 HTML escape). (`lib/blocks.ts`의 `fillPlaceholders`)
- **푸터 옵션**: 소셜 아이콘 on/off, 전송자명·주소 편집. (`components/TemplateComposer.tsx`)

### 운영 / 편의 / 안정성
- **테스트 발송**: "나에게 테스트" 버튼 — 실수신 전 본인 받은편지함에서 실물 검수.
- **발송 중단**: 발송 중 "■ 발송 중단" 버튼(서버 루프가 매 건 abortRequested 확인). (`app/api/sends/[id]/route.ts` PATCH)
- **확인 모달 강화**: 실제 렌더 미리보기(iframe) + 100명 이상 경고 + (광고)/Reply-To 요약.
- **헬스체크**: `/api/health`(공개) + 배포 스크립트가 배포 후 200 검증.
- **데이터 유실 레이스 수정**: deploy 의 `git reset --hard`/`clean` 전 서버 `data/` 스냅샷 → 작업 후 복원, `clean -e data`. (`deploy-email-blast`)
- **동시성**: 로고 레지스트리 atomic+lock 쓰기. stale 발송 정리 cutoff 를 수신자 수 비례 동적 산정.
- **Node 고정**: `.nvmrc`(20) + `package.json` engines.

---

## 2. ⚠️ 배포 전 필수 사용자 작업 (체크리스트)

### 2-1. 환경변수 추가 (`~/.claude/secrets/.env` → `.env.local`)
| 변수 | 필수? | 설명 |
|---|---|---|
| `ADMIN_EMAILS` | 권장 | 관리자 이메일(쉼표구분). 남의 리스트·템플릿 편집/삭제, 발신자·억제목록 관리 권한. 예: `junsang.yoo@rlwrld.ai` |
| `APP_BASE_URL` | 선택 | 수신거부 링크 베이스. 기본 `https://email-blast.rlwrld.co` (그대로면 생략 가능) |
| `RESEND_WEBHOOK_SECRET` | 권장 | Resend webhook 서명 시크릿(`whsec_…`). 없으면 open/click/bounce **영속 안 됨**(폴링만 동작) |
| `SENDER_POSTAL_ADDRESS` | 해외발송 시 | 발신자 물리 우편주소(CAN-SPAM). 미설정 시 푸터에서 생략 |
| `SENDER_ORG_NAME` | 선택 | 전송자 명칭. 기본 `RLWRLD Inc.` |
| `SENDER_CONTACT_EMAIL` | 선택 | 수신거부 mailto 주소. 기본 `inquiry-launch@rlwrld.ai` |
| `MAX_RECIPIENTS_PER_SEND` / `USER_DAILY_SEND_LIMIT` / `USER_HOURLY_SEND_LIMIT` / `SEND_MIN_GAP_MS` | 선택 | 발송 상한·간격 튜닝. 기본 1000 / 5000 / 2000 / 220ms |

### 2-2. Resend 대시보드
1. **발신 도메인 인증**: `rlwrld.ai`(또는 서브도메인)의 **SPF·DKIM·DMARC** DNS 레코드 등록·검증. *미설정 시 Gmail/Outlook 이 거부·스팸 처리(전달성 붕괴).*
2. **Webhook 등록**: Endpoint `https://email-blast.rlwrld.co/api/webhooks/resend`, 이벤트 `email.*` 구독 → **Signing Secret 복사 → `RESEND_WEBHOOK_SECRET`**.
3. **Open/Click 트래킹 활성화**: 도메인 설정에서 열람·클릭 추적 ON (안 하면 상태가 delivered 에 머묾).
4. (필요 시) **Rate limit 상향 요청**: 기본 초당 5건. 대량 발송 잦으면 support 에 상향 요청.
5. **새 발신자 추가 시**: UI로 추가하는 모든 from 주소(events@, hr@ 등)는 Resend 에 **검증된 주소/도메인**이어야 발송 성공.

### 2-3. 운영 인프라
1. **외부 모니터링**: UptimeRobot/healthchecks.io 등으로 `https://email-blast.rlwrld.co/api/health` 감시 → 다운 시 Slack/메일 알림.
2. **실시간 데이터 백업** (SPOF 완화): 현재 GitHub 백업은 deploy 시점에만. 미니PC 디스크 사고 대비로 둘 중 하나 권장:
   - 미니PC cron 으로 `data/` 를 보유 중인 **Oracle Cloud 인스턴스로 rsync**(15분 간격), 또는
   - 미니PC에 **쓰기 권한 deploy key** 부여 후 `data/` 만 주기 commit+push.
   *(deploy 의 reset 데이터 유실 레이스는 이미 코드로 막았으나, 디스크 자체 사망은 별도 백업 필요.)*

### 2-4. 법무 확인 (외부 발송 시)
- 외부 수신자 대상 행사초청·홍보는 **사전 수신동의** 원칙(정보통신망법). 동의 근거 없으면 발송 보류 또는 법무 검토. "광고성 메일" 체크박스로 (광고) 표기·수신거부는 자동 처리되나, **동의 확보 자체는 운영 책임**.

---

## 3. 배포 후 권장 (점진)
- 기존 4개 템플릿은 **블록 편집기에서 한 번 재저장**하면 새 컴플라이언스 푸터(수신거부 링크)가 본문에 반영됨. (재저장 전에도 `List-Unsubscribe` 헤더는 자동 주입되어 Gmail 원클릭은 동작)
- 첫 사용자 온보딩 가이드(빈 상태 안내) 보강, 템플릿/리스트 검색·정렬, 모달 접근성(포커스 트랩) 등 잔여 P3.

---

## 4. 의도적으로 보류한 항목 (이유)
| 항목 | 이유 / 대안 |
|---|---|
| 세션 즉시 무효화(jti/revocation) | 미들웨어가 Edge 런타임이라 파일 기반 무효화 조회 불가. 7일 만료 유지. 탈취 우려 시 `AUTH_SESSION_SECRET` 교체(전원 재로그인). |
| 첨부파일 | Resend 지원하나 업로드·용량·보안 표면이 커 별도 단계로 분리. |
| Outlook VML 버튼 폴백 | 실측 없이 작성 위험. 현재 table+hex+bgcolor 로 "깨지지 않게" 처리. 발송 전 Outlook 실측 권장. |
| raw HTML sanitize 라이브러리 | 새 의존성 설치 대신 CSP sandbox 로 실행 차단(동등 효과, 의존성 0). |
| 발송로그 보존정책/페이지네이션 | 현재 소수·저빈도라 영향 적음. 누적 시 도입. |

---

## 5. 신규 파일
```
lib/senders.ts          발신자 레지스트리(내장+커스텀)
lib/suppression.ts      수신거부/반송 억제 목록
lib/unsubscribe.ts      수신거부 서명 토큰
lib/send-guards.ts      내용 해시(멱등성) + 전역 스로틀
app/api/from/route.ts           발신자 관리(관리자)
app/api/health/route.ts         헬스체크(공개)
app/api/unsubscribe/route.ts    수신거부(공개)
app/api/suppression/route.ts    억제목록 조회/해제
app/api/webhooks/resend/route.ts  Resend webhook 수신(서명검증)
.nvmrc                  Node 20
lib/*.test.ts (3)       unsubscribe / send-guards / config 테스트
```
