# CLAUDE.md — RLWRLD Email Blast

## 목적
RLWRLD 내부 **일괄 이메일 발송 운영 도구**. 행사 초청·리마인더 등 브랜드 이메일을
템플릿 기반으로 만들고, 여러 수신자에게 **Resend**로 발송한 뒤 발송 상태를 추적한다.
비개발자(운영자)가 HTML 없이도 온브랜드 메일을 만들 수 있는 것이 핵심.

- 운영 도메인: `https://email-blast.rlwrld.co`
- 사용자: RLWRLD 내부 인원 (소수, 저빈도 발송)

## 스택
- **Next.js 14 (App Router) + React 18 + TypeScript + Tailwind**
- 발송: **Resend** SDK (SSE 스트리밍으로 1건씩 진행 표시)
- 이미지 호스팅: **Azure Blob** (`dexbenchsite/rldx-1-launch`, 로고와 동일 컨테이너)
- 인증: **Google Workspace OAuth** (@rlwrld.ai 도메인 제한) + HS256 JWT 세션 쿠키
- 테스트: vitest (순수 로직만 — 렌더러·세션)
- 배포: 미니PC(`192.168.0.88`) + systemd + Caddy(자동 HTTPS)
- **DB 없음.** 상태는 파일로 저장(아래 "데이터 저장" 참고)

## 디렉토리 구조
```
brand.config.ts          ★화이트라벨 단일 소스 (회사명·도메인·발신자·로고·색상·UI 문구). 비밀 제외 전부.
app/
  page.tsx               메인 (좌 SendForm / 우 슬라이드 TrackingSidebar)
  login/page.tsx         Google 로그인 화면
  api/
    auth/google/         OAuth 시작 + callback
    auth/logout/         세션 쿠키 삭제
    send/                발송 (NDJSON 스트리밍, nodejs runtime)
    sends/               발송 이력 목록 + 단일 상세(?withStatus=1 → Resend 라이브 조회)
    lists/               수신자 리스트 CRUD + 멤버 임포트
    logos/               헤더 로고 목록·업로드·삭제
    templates/           목록·미리보기(?preview=샘플치환 / ?built=토큰보존 JSON)·저장(HTML 직접) /compose·/render·/spec
    upload/              이미지 → Azure 업로드 → 공개 URL
    config/              UI 상수(발신자 목록+내 계정 합성, 현재 사용자, isAdmin)
    from/                발신자 레지스트리 (공용=관리자만, 개인 닉네임=본인)
    admins/              관리자 레지스트리 (조회·추가·삭제 모두 관리자만)
    suppression/         수신거부/반송 목록 (조회 전원, 해제 관리자만)
components/
  SendForm.tsx           이메일 선택·리스트 선택·ad-hoc·발송 (단계형 UI, 발신자 그룹·내 발신 이름 설정)
  ConfirmSendModal.tsx   발송 최종 확인 3-pane (좌 요약 / 중앙 수신자별 치환 완료 미리보기 / 우 수신자 리스트)
  TrackingSidebar.tsx    발송 이력 카드(상태 분포 바) + 상세 모달 + 라이브 상태 조회
  TemplateComposer.tsx   블록 조립기 (캔버스 스타일은 lib/blocks.ts 와 공유 — 이중 구현 금지)
  AddTemplateDialog.tsx  HTML 직접 입력 + 이미지 동시 업로드(파일명 매칭 src 자동 치환)
  RecipientInput.tsx     수신자 입력 공용 (자유텍스트 실시간 파싱 + CSV/XLSX 컬럼 매핑 확인 + 이름 인라인 수정)
  ArchiveDialog.tsx      보관함(복원·영구삭제)
  ListManager.tsx        리스트 생성·편집·임포트·삭제
  ListEditor.tsx         리스트 편집 모달 (멤버 이름 인라인 수정)
  ListPicker.tsx         발송 화면용 리스트 다중선택
  AdminSettings.tsx      설정 (기본 탭 수신거부/반송, 발신자·관리자 탭은 비관리자에게 자물쇠)
  StatusGuide.tsx        Resend 상태(Sent/Delivered/Bounced…) 한 줄 설명
  ThemeToggle.tsx        라이트/다크 토글
lib/
  blocks.ts              블록 스키마 + renderTemplate (디자인 시스템 고정 렌더러) ★핵심. 색·로고·소셜은 brand.config 참조
  personalize.ts         개인화 치환 ({{name}}/{{firstName}}/{{name|기본값}}/{{email}}) — 클라이언트/서버 공용, fs 의존 금지
  templates.ts           파일 기반 이메일 CRUD + spec 저장/렌더 (신규 동명 저장은 overwrite 플래그 없으면 409)
  lists.ts               수신자 리스트 CRUD + 출처 보존 resolve
  send-log.ts            발송 레코드(data/sends/*.json) + resendId 인덱스 + stale cleanup
  logos.ts               내장+커스텀 헤더 로고 레지스트리(data/logos.json)
  import-parser.ts       CSV/XLSX 분석(헤더 동의어 매칭·컬럼 역할 추론) + Recipient[] 생성 (클라이언트 사이드)
  senders.ts             발신자 레지스트리 (scope: shared/personal + owner). 발송 검증 isSenderAllowedFor
  admins.ts              관리자 레지스트리 (env 시드 ∪ data/admins.json). isAdminAsync/canManageAsync ★권한은 항상 이것
  atomic.ts              atomic write + per-key 직렬화 mutex + 손상 JSON 백업
  storage/               이미지 스토리지 추상화. index.ts=진입점+registry, image-validation.ts=magic-bytes 검증(provider 무관), adapters/azure.ts=Azure Blob. 백엔드 선택은 brand.config.assets.provider, 키는 .env
  google.ts              OAuth 헬퍼 + 도메인 검증 + origin 계산
  session.ts             HS256 JWT 서명/검증 (Edge+Node 호환, Web Crypto)
  auth.ts                cookies()로 currentUserEmail 조회 (라우트용)
  recipients.ts          이메일 파싱/중복제거 + setNameInText(미리보기 이름 인라인 수정)
  config.ts              From 내장 발신자, REPLY_TO 기본값, 발송 상한 (sync isAdmin 은 env 시드만 — 사용 금지, admins.ts 사용)
middleware.ts            세션 검증 (미인증 → /login). 정적 자산은 matcher 제외.
instrumentation.ts       서버 부팅 시 stale `running` send 정리
templates/               {name}.html + {name}.json(블록 spec) + _meta.json
data/
  lists/{slug}.json      수신자 리스트 (운영 source of truth, GitHub 백업 대상)
  sends/{id}.json        발송 레코드 (recipients 포함, GitHub 백업 대상)
  logos.json             커스텀 헤더 로고 레지스트리 (GitHub 백업 대상)
  from.json              커스텀 발신자 (scope/owner 포함, GitHub 백업 대상)
  admins.json            런타임 추가 관리자 (GitHub 백업 대상)
  suppression.json       수신거부/반송 억제 목록 (GitHub 백업 대상)
```

## 용어 규칙 (UI)
- 발송물(구 "템플릿") = **이메일**, 작성기의 프리셋(구 "틀") = **템플릿**.
- 단, 코드 식별자·디렉토리(`templates/`)·API 경로·데이터 필드(`templateName` 등)는 데이터 호환을 위해 그대로 둔다. **UI 문자열만** 새 용어를 쓴다.

## 환경변수 / 시크릿
**비밀(키)은 `.env.local`, 브랜드(공개 정체성)는 `brand.config.ts`로 분리한다.** 화이트라벨
전환·세부 가이드는 `docs/WHITELABEL.md` 참고.
**Secret source of truth: `~/.claude/secrets/.env`** → 프로젝트 `.env.local`로 복제 → deploy가 미니PC로 push.
값은 절대 코드/문서에 하드코딩하지 않는다(이름만 사용).

| 변수 | 용도 |
|---|---|
| `RESEND_RLWRLD_API_KEY` | 발송용 키 |
| `RESEND_EMAIL_TRACKING_API_KEY` | 트래킹/발송용 full access 키 |
| `AZURE_STORAGE_ACCOUNT` / `_KEY` / `_CONTAINER` | 이미지 업로드 (account key 방식) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth (RLWRLD 클라이언트 재사용) |
| `AUTH_SESSION_SECRET` | 세션 JWT 서명 (= `JWT_SECRET`) |
| `ADMIN_EMAILS` / `APP_BASE_URL` / `SENDER_*` | (선택) 관리자·앱 URL·컴플라이언스. 기본값은 `brand.config.ts` |

- **로그인/발신 도메인은 env가 아니라 `brand.config.ts`** (`auth.loginDomain`/`auth.senderDomain`)에서 관리한다.
  예전 `ALLOWED_DOMAIN` env는 클라이언트 hydration 일관성을 위해 brand.config 상수로 이동했다.

- Azure account key 조회: `az storage account keys list -n dexbenchsite`
- Google OAuth 클라이언트는 대시보드와 공용 → Console에 redirect URI 등록 필요:
  `{origin}/api/auth/google/callback` (localhost:3001 + 배포 도메인 각각)

## 핵심 흐름
- **인증**: `/api/auth/google` → 구글(hd=rlwrld.ai) → callback에서 도메인 검증 → JWT 세션 쿠키. 미들웨어가 모든 경로 보호.
- **이메일 생성(블록)**: UI에서 블록 나열 → `/api/templates/render`로 미리보기 → `/api/templates/compose`로 `{name}.json`(spec) + `{name}.html`(렌더) 저장. 색/글꼴은 `lib/blocks.ts`에 고정. 본문 너비는 spec.width(default 600 / wide 680). 신규 동명 저장은 409 (편집은 `overwrite:true`).
- **개인화**: `lib/personalize.ts` 의 `{{name}}`/`{{firstName}}`/`{{name|기본값}}`/`{{email}}`. 본문(HTML escape)과 제목(평문) 모두 발송 시 수신자별 치환. 미리보기·경고(`hasBlankNameRisk`)도 같은 모듈 사용 — 미리보기≠실발송 불일치 금지.
- **리스트**: `/api/lists` CRUD. 멤버는 CSV/XLSX 임포트(헤더 동의어 매칭 + 컬럼 매핑 확인 UI, 클라이언트 파싱) 또는 자유텍스트 붙여넣기. 발송 시 리스트 다중선택 + ad-hoc 자유텍스트 병행.
- **발신자**: 내장+공용(shared, 관리자 관리) + 개인(personal, 본인 주소 닉네임) + "내 계정" 가상 옵션(저장 없이 합성). 발송 검증은 `isSenderAllowedFor` — **미등록 from 은 조용한 폴백 없이 400**.
- **관리자**: env `ADMIN_EMAILS`(시드) ∪ `data/admins.json`. 판정은 반드시 `isAdminAsync`/`canManageAsync` (await 누락 시 전원 관리자가 되는 사고 주의).
- **발송**: `/api/send`가 리스트 + ad-hoc 합쳐 dedupe → 발송 직전 ConfirmSendModal(3-pane, `?built=` 토큰보존 HTML 을 클라이언트에서 수신자별 치환) → Resend로 1:1 발송 → NDJSON 스트림으로 진행/성공/실패 보고 → 레코드는 `data/sends/{id}.json`에 누적 기록. 클라이언트가 끊겨도 발송은 계속 진행되며 결과는 파일에 남는다.
- **트래킹(이력)**: `/api/sends` 가 sends/*.json 을 시간 역순으로 반환. 사이드바는 15초 폴링(사이드바가 열려 있을 때만). 상세 모달에서 `?withStatus=1` 로 Resend 라이브 상태(delivered/opened/bounced…)를 N+1 fetch + 5초 캐시로 조회.
- **자동 정리**: 서버 부팅 시(`instrumentation.ts`) + `/api/sends` GET 5분 throttle 로 `running` 상태 stale send 를 `aborted` 마킹.

## 데이터 저장
- **`templates/`** : **프로덕션이 source of truth** (운영 UI에서 생성). 배포 시 `서버 → 로컬 → GitHub`로
  자동 백업한 뒤 정렬하므로 덮어쓰기로 사라지지 않는다. `./deploy-email-blast backup`으로 백업만 따로 가능.
- **`data/lists/`, `data/sends/`, `data/logos.json`, `data/from.json`, `data/admins.json`, `data/suppression.json`** : `.gitignore` 화이트리스트로 GitHub에 백업.
  deploy 1단계의 `backup_prod` (rsync `--delete`) 가 prod → local 동기화 후 commit + push 하므로 미니PC 디스크 사고 대비 가능.
  dev 발송분이 working tree 에 남아도 다음 deploy 의 `backup_prod` 가 prod 데이터로 덮어써 정합성을 유지한다.
- **`data/sent-ids.json.legacy`** : 옛 트래킹 구조 잔재. 사용처 없음. `.gitignore` 로 ignore.

## 버전관리 / 배포
- GitHub: **`RLWRLD/rlwrld-email-blast`** (private), 기본 브랜치 `main`.
- 서버는 git clone(읽기 전용 **deploy key** `~/.ssh/email-blast-deploy`, SSH remote)으로 `git pull`.
- `.env.local`은 gitignore → deploy가 scp로 별도 전송. 시크릿은 GitHub에 없음.
```bash
./deploy-email-blast          # 프로덕션 템플릿 백업 → 로컬 commit+push → 서버 git pull+install+build+restart → CSS 200 검증
./deploy-email-blast backup   # 프로덕션 템플릿/메타만 GitHub로 백업
./deploy-email-blast logs     # 실시간 로그
./deploy-email-blast status   # 서비스 상태
```
- 재시작에 sudo 필요. 무인 배포하려면 미니PC에 1회 설정:
  `echo "rlwrld ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart email-blast" | sudo tee /etc/sudoers.d/email-blast`
- 배포 후 화면이 깨지면 대개 재시작 누락(옛 빌드 물고 있음) → 스크립트의 CSS 200 검증이 자동으로 잡아줌.

## 개발
```bash
npm run dev    # http://localhost:3001
npm test       # vitest (lib/blocks, lib/session)
npm run build  # 프로덕션 빌드
```

## 컨벤션
- 전역 규칙(`~/.claude/CLAUDE.md`) 따름: 대화·문서 한국어, 코드/주석 영어, 커밋 영어.
- 파일 생성/수정·설치·배포 전 계획 제시 + 컨펌. 시크릿 하드코딩 금지.
- 이메일 본문 텍스트는 `lib/blocks.ts`에서 전부 HTML escape, URL은 http/https/mailto만 허용.
- 미들웨어는 Edge 런타임 → Node 전용 모듈 금지(JWT는 Web Crypto로 직접 구현).
- 미리보기 iframe 은 항상 `sandbox="allow-same-origin"` — 임의 HTML/스크립트가 부모 페이지를 건드리지 않게.
- `AUTH_SESSION_SECRET` 누락 시 `NODE_ENV=production` 이면 즉시 throw (silent dev-key 폴백 금지).
