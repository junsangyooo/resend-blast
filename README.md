# RLWRLD Email Blast

RLWRLD 내부 일괄 발송 운영 도구.

- 도메인: `email-blast.rlwrld.co`
- 인증: **Google Workspace 로그인** (@rlwrld.ai 계정만, `hd` 클레임 + 이메일 도메인 AND 검증). 세션은 HS256 JWT 쿠키
- 발송: Resend, 발신자 화이트리스트 강제 (`lib/config.ts`)
- **화이트라벨**: 회사 종속 값(브랜드·도메인·로고·색상)은 `brand.config.ts` 한 곳. 다른 회사/개인용 전환은 `docs/WHITELABEL.md` 참고
- 트래킹: Resend Full access key → 발송별 send 파일 + 자동 갱신
- 템플릿: 파일 기반 (`templates/{name}.html` + `.json` spec) + UI에서 생성
- 리스트: 파일 기반 (`data/lists/{slug}.json`) — CSV/Excel import 지원, 다중선택 발송

## 개발

```bash
npm install
cp ~/.claude/secrets/.env  .env.local   # 시크릿 동기화 (또는 직접 작성)
npm run dev                              # http://localhost:3001
npm test                                 # vitest (lib/blocks, lib/session)
```

env 변수(비밀): `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `AUTH_SESSION_SECRET` / `RESEND_RLWRLD_API_KEY` / `RESEND_EMAIL_TRACKING_API_KEY` / `AZURE_STORAGE_ACCOUNT` / `AZURE_STORAGE_KEY` / `AZURE_STORAGE_CONTAINER`

로그인/발신 도메인은 env가 아니라 `brand.config.ts`(`auth.loginDomain` / `auth.senderDomain`)에서 관리한다.

OAuth redirect URI를 Google Console에 등록: `{origin}/api/auth/google/callback` (localhost:3001 + 배포 도메인 각각).

## 배포

```bash
./deploy-email-blast         # 코드+env push → 빌드 → restart (실패 시 자동 롤백)
./deploy-email-blast backup  # 프로덕션 templates/ + data/ → GitHub 백업
./deploy-email-blast logs    # 실시간 로그
./deploy-email-blast status  # 서비스 상태
```

특징:
- **동시 배포 락**(`flock`): 두 사람이 동시에 배포 시도하면 두 번째는 거부
- **자동 롤백**: 서버 빌드/재시작 실패 시 이전 commit SHA로 되돌리고 재기동
- **상태 백업**: `templates/`와 `data/`(리스트·발송로그)를 매 배포마다 GitHub에 백업

첫 배포 절차:
1. `./deploy-email-blast init` 실행 → 출력된 systemd unit + Caddy 설정을 미니PC에서 실행
2. DNS A 레코드 `email-blast.rlwrld.co` → 미니PC IP 등록
3. Caddy가 자동으로 Let's Encrypt SSL 발급 (별도 certbot 불필요)
4. `.env.local` 작성 후 `./deploy-email-blast`

## 핵심 워크플로우

### 1) 수신자 리스트 만들기
좌측 rail "리스트" → ＋ 새 리스트 → 이름 입력 → **CSV/Excel 임포트** 또는 직접 입력
- CSV/Excel: 1열(email) 또는 2열(email, name). 헤더 자동 감지 (email/name/이메일/이름)
- 클라이언트 사이드 파싱 (SheetJS) — 명단이 서버 안 거침
- 합치기 / 덮어쓰기 모드 선택
- **권한**: 모두 보기·편집 가능, **삭제는 생성자만**

### 2) 템플릿 만들기
"템플릿" 메뉴 → "블록으로 만들기" (권장) 또는 "HTML 직접 입력"
- 블록: Hero / 문단 / 번호 목록 / 어젠다 / 이미지 / CTA
- 디자인 시스템 고정 (`lib/blocks.ts`) — HTML 몰라도 온브랜드
- 이미지는 Azure Blob에 업로드 (PNG/JPG/GIF/WEBP, magic byte 검증)

### 3) 발송
메인 화면:
1. 템플릿 선택
2. 리스트 다중 선택 (체크박스) + 필요시 ad-hoc 직접 입력
3. 발송하기 → **확인 모달에서 리스트명·From·subject·최초 10명 명단 확인**
4. SSE 진행 표시. 발송 중 페이지 이탈 시 경고
5. 완료 후 실패 건은 클립보드 복사 버튼 제공

### 4) 트래킹
좌측 rail "로그" → **send 단위 카드** (발송 1건 = 카드 1개)
- 리스트명 칩 클릭 → 해당 리스트의 전체 발송 이력으로 필터
- 카드 클릭 → 수신자별 상태 상세 모달 (Resend 라이브 상태 조회)

## 발신자(From) 추가
`lib/config.ts`의 `FROM_WHITELIST` 배열에 추가:
```ts
export const FROM_WHITELIST = [
  { value: "RLDX-1 by RLWRLD <launch@rlwrld.ai>", label: "RLDX-1 (launch@)" },
  { value: "RLWRLD Events <events@rlwrld.ai>", label: "Events" }, // 추가 예시
];
```
@rlwrld.ai 도메인 외에는 자동으로 거부됨.

## 데이터 모델
```
data/
  lists/{slug}.json     # 수신자 리스트 (atomic write)
  sends/{id}.json       # 발송 1건 = 1파일. 동시쓰기 충돌 없음
  sent-ids.json.legacy  # 마이그레이션 전 발송 (읽기 전용)
  logos.json            # 업로드된 헤더 로고 메타
templates/
  {name}.html           # 렌더 결과
  {name}.json           # 블록 spec (재편집용)
  _meta.json            # 제목·설명·archived 플래그
```
프로덕션이 원본. 배포 시 자동으로 GitHub 백업.

## 보안 메모
- `.env.example` 미사용. 시크릿은 `~/.claude/secrets/.env`만 사용.
- 이미지 업로드: SVG 차단, magic byte로 실제 형식 검증, content-type 신뢰 안 함.
- OAuth redirect: `hd` 클레임 + 이메일 도메인 AND 검증, `//evil.com` open redirect 차단.
- 발송: `from` 화이트리스트 강제. UI 우회해도 서버에서 거부.

## 테스트
```bash
npm test   # lib/blocks (HTML escape, 디자인 시스템) + lib/session (JWT)
```
