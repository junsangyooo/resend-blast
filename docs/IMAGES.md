# 이미지 파이프라인 가이드 — 메일에 이미지를 싣는 모든 방법

메일에 이미지를 넣는 방법은 **딱 2가지**고, 이 앱은 둘 다 지원한다(`brand.config.ts` 한 줄로 전환).
**어떤 인프라가 필요한지가 방법마다 다르다** — 이 문서가 그걸 전부 설명한다.

> 흔한 오해: "CID(첨부)를 하려면 서버를 세워야 하나?" → **아니다.** CID는 이미지가 메일에 박혀
> 나가므로 **공개 서버가 전혀 필요 없다.** 서버/버킷 구축이 필요한 건 **hosted(URL) 방식**이다.

## 0. 두 개의 축

이미지 설정은 `brand.config.ts` 의 `assets` 에서 **2개 축**으로 정한다.

```ts
assets: {
  provider: "local",     // 저장: 어디에 보관하나  (local | azure | r2 | …)
  delivery: "attach",    // 전달: 메일에 어떻게 싣나 (attach | hosted)
}
```

- **provider** = 업로드한 이미지를 **어디에 저장**하나
- **delivery** = 저장된 이미지를 **메일에 어떻게 싣나** (첨부 vs URL 참조)

## 1. 메일 이미지의 두 방식 (원리)

| | **attach (CID 인라인 첨부)** | **hosted (URL 참조)** |
|---|---|---|
| HTML | `<img src="cid:이미지ID">` | `<img src="https://…/x.png">` |
| 이미지 위치 | **메일 안에** base64로 동봉 | **외부 공개 URL**에 있고, 열 때 받아옴 |
| 공개 서버 필요? | ❌ 불필요 | ✅ 필요 (앱 또는 버킷이 공개 도메인) |
| 영속성 | 메일과 함께 영구 보존 | URL이 죽으면 이미지 깨짐 |
| 대량 효율 | ❌ 수신자마다 재전송 | ✅ 한 번 올리고 공유 |
| 크기 한도 | 메일 1통 40MB(base64 후) | 사실상 없음 |

→ **소수·개인 발송 = attach**, **대량 발송 = hosted** 가 정답.

## 2. 의사결정 — 내 상황엔 어떤 조합?

| 상황 | provider | delivery | 필요 인프라 |
|---|---|---|---|
| **개인/소수, 가장 간단** | `local` | `attach` | **없음** (서버 디스크만) |
| 중간 규모, 앱을 이미 공개 도메인에 띄움 | `local` | `hosted` | 공개 도메인 + 영속 디스크 |
| 대량/CDN, 여러 서버 | `r2`(또는 azure/s3) | `hosted` | 오브젝트 스토리지 버킷 |

아래에서 각 경로를 **무엇을 세우고 어떻게 연결하는지** 단계별로 설명한다.

---

## 경로 A. `local` + `attach` — 인프라 0 (기본·추천)

**필요한 것: 없음.** 외부 계정도, 공개 URL도, 별도 서버도 필요 없다.

**파이프라인 (이미 구현돼 있음):**
```
[업로드]  UI 이미지 업로드 → /api/upload → 서버 디스크 data/uploads/<uuid>.png
[작성]    블록/HTML 에 그 이미지 삽입 (src = /api/assets/<uuid>.png)
[발송]    /api/send 가 발송 직전 1회:
            · 본문의 로컬 이미지를 디스크에서 읽어 base64 + CID 첨부로 변환
            · <img src> 를 cid:<id> 로 치환  (lib/email-images.ts)
          → Resend 가 이미지를 메일에 동봉해 발송
```

**유일한 요건:** 업로드 파일이 보존되도록 **영속 디스크**일 것.
- ✅ 일반 서버(VM/클라우드 인스턴스/홈서버) — `data/` 가 디스크에 남으므로 OK
- ❌ 서버리스(Vercel 등 임시 디스크) — 배포 때마다 업로드가 날아감 → 이 경우 경로 C 사용

**제약:** 메일 1통당 40MB(이미지 base64 후), 수신자마다 이미지 재전송(대량 비효율).

> 이게 기본값(`provider:"local"`, `delivery:"attach"`)이다. clone 후 아무것도 안 해도 이미지가 메일에 박혀 나간다.

---

## 경로 B. `local` + `hosted` — 앱이 자기 이미지를 서빙

앱 자신이 이미지를 **공개 URL로 서빙**한다. 별도 버킷 없이 대량에 좀 더 효율적.

**필요한 것:**
1. 앱이 **공개 HTTPS 도메인**으로 떠 있어야 함 (예: `https://email-blast.yourbrand.com`)
2. **영속 디스크** (업로드 보존)
3. `brand.config.ts` 의 `identity.appBaseUrl` 또는 `.env.local` 의 `APP_BASE_URL` 이 그 공개 도메인일 것

**파이프라인:**
```
[업로드]  /api/upload → data/uploads/<uuid>.png,  URL = {APP_BASE_URL}/api/assets/<uuid>.png
[발송]    delivery=hosted 이므로 변환 없이 그 URL 그대로 본문에 둠
[열람]    수신자 메일 클라이언트가 https://yourapp/api/assets/<uuid>.png 를 직접 로드
          (그 라우트는 공개 — middleware allowlist 에 포함됨)
```

**설정:**
```ts
assets: { provider: "local", delivery: "hosted", … }
```
```
# .env.local
APP_BASE_URL=https://email-blast.yourbrand.com
```

**주의:** 이미지가 살아있으려면 **앱이 계속 떠 있어야** 한다(앱 내리면 과거 메일 이미지 깨짐).
도메인/URL 을 바꾸면 과거 메일의 이미지 링크도 깨진다.

---

## 경로 C. 오브젝트 스토리지(R2/S3/Azure) + `hosted` — CDN·대량

이미지를 전용 버킷에 올리고 CDN으로 서빙한다. 대량·다중서버·egress 효율에 유리.

### C-1. Cloudflare R2 (추천 — 무료 10GB, egress 0)

**(1) 버킷 만들기**
1. Cloudflare 대시보드 → **R2** → **Create bucket** → 이름 입력(예: `email-blast-assets`)

**(2) 공개 접근 설정** (메일 클라이언트가 인증 없이 로드해야 함)
- 간단: 버킷 **Settings → Public access → r2.dev 하위도메인 허용** → `https://pub-xxxx.r2.dev` 공개 URL 확보
- 권장: **커스텀 도메인 연결** (`images.yourbrand.com`) → R2 버킷 Settings → Custom Domains

**(3) API 토큰 발급**
- R2 → **Manage R2 API Tokens** → **Create API token** → 권한 **Object Read & Write**
- 발급되는 **Access Key ID**, **Secret Access Key**, 그리고 **Account ID**(대시보드 우측) 확보

**(4) 어댑터 작성** — `lib/storage/adapters/r2.ts` (S3 호환):
```ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import type { StorageAdapter } from "../types";

const PREFIX = "assets/email-blast";

export class R2Adapter implements StorageAdapter {
  readonly name = "r2";
  async put(data: Buffer, contentType: string, ext: string): Promise<string> {
    const accountId = process.env.R2_ACCOUNT_ID!;
    const bucket = process.env.R2_BUCKET!;
    const publicBase = process.env.R2_PUBLIC_BASE!.replace(/\/+$/, ""); // r2.dev 또는 커스텀 도메인
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const key = `${PREFIX}/${randomUUID()}.${ext}`;
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: data,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }));
    return `${publicBase}/${key}`;
  }
}
```

**(5) 패키지 설치**
```bash
npm install @aws-sdk/client-s3
```

**(6) 레지스트리 등록** — `lib/storage/index.ts` 의 `ADAPTERS` 에 한 줄:
```ts
import { R2Adapter } from "./adapters/r2";
const ADAPTERS = {
  local: () => new LocalAdapter(),
  azure: () => new AzureAdapter(),
  r2: () => new R2Adapter(),   // ← 추가
};
```

**(7) 설정 + 키**
```ts
// brand.config.ts
assets: { provider: "r2", delivery: "hosted", … }
```
```
# .env.local
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=email-blast-assets
R2_PUBLIC_BASE=https://images.yourbrand.com   # 또는 https://pub-xxxx.r2.dev
```

> ⚠️ 반환 URL은 **인증 없이 열리는 공개 URL**이어야 한다(서명 URL·비공개 버킷 불가) —
> 메일 클라이언트가 토큰 없이 로드하기 때문.

### C-2. AWS S3 — 동일 패턴
위 R2 어댑터에서 `endpoint` 를 빼고 `region` 을 실제 리전으로, 키를 `AWS_*` 로 바꾸면 된다.
버킷을 public-read(또는 CloudFront)로 두고 `S3_PUBLIC_BASE` 를 그 URL로.

### C-3. Azure Blob — 이미 내장
어댑터(`lib/storage/adapters/azure.ts`)가 기본 포함. `provider:"azure"` + `.env.local` 의
`AZURE_STORAGE_ACCOUNT/_KEY/_CONTAINER` 만 채우면 된다(컨테이너는 public read).

---

## 3. 전체 연결도 (어디서 어떻게 이어지나)

```
업로드:
  UI → POST /api/upload → lib/storage(index.ts) → [provider 어댑터].put()
       → 저장 + 공개/로컬 URL 반환 → 블록 spec/HTML 에 그 URL 삽입

발송:
  POST /api/send → buildFullHtml → (brand.assets.delivery 분기)
     ├ "attach": lib/email-images.inlineLocalImages()
     │           → 로컬 이미지 base64 + CID 첨부, src→cid:  → Resend(attachments)
     └ "hosted": 변환 없음, URL 그대로 → Resend
```

- **추가 스토리지를 꽂아도 호출부(`/api/upload`, `/api/send`)는 안 건드린다** — 어댑터만 추가.
- delivery 토글은 발송 경로에서만 분기한다.

## 4. 공통 주의사항

- **이미지 차단**: 일부 메일 클라이언트는 기본적으로 외부 이미지를 가린다("이미지 표시" 클릭 전).
  CID 인라인은 상대적으로 더 잘 보이는 편이지만, 둘 다 이미지에만 의존하는 본문은 피하고
  텍스트를 충분히 둘 것(전달성에도 유리).
- **영속성**: local 계열은 디스크가 날아가면 끝 — 백업 또는 오브젝트 스토리지 고려.
- **용량**: attach 는 메일당 40MB(base64 후). 이미지를 미리 최적화(리사이즈/압축)할 것.

---

전체 셋업 절차는 [`docs/SETUP.md`](SETUP.md), 화이트라벨 구조는 [`docs/WHITELABEL.md`](WHITELABEL.md).
