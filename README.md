# Email Blast

비개발자도 **HTML 없이 온브랜드 이메일을 만들어** 여러 수신자에게 발송하고, 발송 상태를
추적하는 **화이트라벨 일괄 메일 발송 툴**. 행사 초청·리마인더·뉴스레터·고객 안내 등에 쓴다.

> 회사/개인 누구나 **`brand.config.ts`(공개 브랜드) + `.env.local`(비밀 키)** 두 파일만
> 채우면 자기 브랜드·계정·디자인으로 동작한다. 코드는 건드리지 않는다.

## 핵심 기능

- **블록 조립기** — 제목·문단·버튼·배지·번호목록·어젠다·그리드·이미지 블록을 쌓아 메일 작성.
  색·글꼴·간격은 디자인 시스템으로 고정돼 **항상 온브랜드**(임의 px·hex 불가).
- **개인화 치환** — `{{name}}` `{{firstName}}` `{{name|기본값}}` `{{email}}` 을 수신자별로 치환
  (본문·제목 모두). 미리보기와 실발송이 동일 로직.
- **수신자 리스트** — CSV/Excel 임포트(헤더 자동 매칭) 또는 자유 텍스트 붙여넣기. 다중 리스트 + ad-hoc 병행 발송.
- **발송 + 진행 추적** — Resend로 1:1 발송, NDJSON 스트리밍으로 건별 진행 표시. 클라이언트가
  끊겨도 발송은 계속되고 결과는 파일에 남는다.
- **트래킹** — 발송 단위 카드 + 수신자별 라이브 상태(delivered/opened/bounced…) 조회.
- **수신거부/반송 관리** — 서명된 수신거부 링크, 억제 목록 자동 반영(컴플라이언스 푸터 포함).
- **두 가지 인증** — `brand.config` 한 줄로 전환:
  - **비밀번호 모드** — 단일 비밀번호 게이트(외부 의존성 0, 가장 빠른 시작)
  - **Google 모드** — Google Workspace 도메인 로그인
- **DB 없음** — 상태는 파일(`data/`, `templates/`)로 저장. 운영 부담이 작다.

## 개인화할 수 있는 것 (코드 수정 없이)

| 무엇 | 어디서 |
|---|---|
| 회사명·앱 제목·도메인·홈페이지 | `brand.config.ts` |
| **디자인 색상**(이메일 + 앱 콘솔 통합 팔레트) | `brand.config.ts` → 디자인 토큰 |
| 로고·소셜 아이콘·링크 | `brand.config.ts` |
| 발신자(From)·기본 회신(Reply-To)·컴플라이언스 푸터 | `brand.config.ts` |
| **로그인 방식**(비밀번호 ↔ Google) | `brand.config.ts` → `auth.mode` |
| 이미지 저장 백엔드(Azure / R2 / …) | `brand.config.ts` → `assets.provider` + `.env.local` |
| 모든 비밀 키 | `.env.local` |

→ **처음 셋업 가이드는 [`docs/SETUP.md`](docs/SETUP.md)**, 화이트라벨 구조 설명은
[`docs/WHITELABEL.md`](docs/WHITELABEL.md).

## 빠른 시작

```bash
git clone <your-repo-url> && cd email-blast
npm install

cp brand.config.example.ts brand.config.ts   # 브랜드 설정 (공개)
cp .env.local.example .env.local              # 비밀 키 (비공개)
# → 두 파일을 본인 값으로 채운다 (docs/SETUP.md 참고)

npm run dev      # http://localhost:3001
npm test         # vitest (렌더러·세션·발송 가드)
npm run build    # 프로덕션 빌드
```

## 스택

- **Next.js 14 (App Router) + React 18 + TypeScript + Tailwind**
- 발송: **Resend** SDK
- 이미지: 스토리지 어댑터 추상화(기본 Azure Blob, R2/S3 등 교체 가능)
- 인증: 비밀번호 게이트 또는 Google OAuth + HS256 JWT 세션 쿠키
- 저장: 파일 기반(`data/`, `templates/`) — 별도 DB 불필요

## 구조 (요약)

```
brand.config.ts        ★브랜드·디자인·인증방식 단일 설정 (gitignore — example 에서 복사)
brand.config.example.ts  위 파일의 커밋용 템플릿
.env.local.example     비밀 키 템플릿
app/                   페이지 + API 라우트(인증·발송·리스트·템플릿·업로드 …)
components/            발송 폼·트래킹·블록 조립기·설정 등 UI
lib/                   blocks(렌더러)·personalize·lists·send-log·senders·admins·storage·session …
templates/             생성된 이메일 (HTML + 블록 spec)
data/                  리스트·발송로그·발신자·관리자·수신거부 (파일 저장)
docs/SETUP.md          ★처음 쓰는 사람용 셋업 가이드
docs/WHITELABEL.md     화이트라벨 구조·이전 가이드
```

## 라이선스

내부/개인용. 배포 전 발신자 물리주소(`SENDER_POSTAL_ADDRESS`)와 발송 도메인 인증(SPF/DKIM)을
반드시 설정한다 — 미설정 시 메일이 스팸 처리되거나 법적 의무를 위반할 수 있다(자세히는 SETUP.md).
