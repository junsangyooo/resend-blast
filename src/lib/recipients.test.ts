import { describe, it, expect } from "vitest";
import { parseRecipientGrid, parseRecipients, setNameInText } from "./recipients";

describe("parseRecipientGrid — multi-source name+email mapping", () => {
  it("탭 구분 (엑셀·구글시트·노션): 이름<TAB>이메일", () => {
    const r = parseRecipientGrid("홍길동\thong@a.com\n김철수\tkim@b.co.kr");
    expect(r.rows).toEqual([
      { email: "hong@a.com", name: "홍길동" },
      { email: "kim@b.co.kr", name: "김철수" },
    ]);
    expect(r.ignored).toEqual([]);
  });

  it("탭 구분, 이메일이 앞 칸이어도 인식 (이메일<TAB>이름)", () => {
    const r = parseRecipientGrid("hong@a.com\t홍길동");
    expect(r.rows).toEqual([{ email: "hong@a.com", name: "홍길동" }]);
  });

  it("마크다운 표: 헤더줄·구분줄 스킵하고 본문만", () => {
    const md = [
      "| 이름 | 이메일 |",
      "| --- | --- |",
      "| 홍길동 | hong@a.com |",
      "| 김철수 | kim@b.co.kr |",
    ].join("\n");
    const r = parseRecipientGrid(md);
    expect(r.rows).toEqual([
      { email: "hong@a.com", name: "홍길동" },
      { email: "kim@b.co.kr", name: "김철수" },
    ]);
    expect(r.ignored).toEqual([]);
  });

  it("쉼표(CSV) 구분 + 영문 헤더 스킵", () => {
    const csv = "name,email\nJohn Doe,john@x.com\nJane,jane@y.com";
    const r = parseRecipientGrid(csv);
    expect(r.rows).toEqual([
      { email: "john@x.com", name: "John Doe" },
      { email: "jane@y.com", name: "Jane" },
    ]);
  });

  it("'이름 <이메일>' 평문 (구분자 없음) — 공백 폴백", () => {
    const r = parseRecipientGrid("홍길동 <hong@a.com>");
    expect(r.rows).toEqual([{ email: "hong@a.com", name: "홍길동" }]);
  });

  it("공백 폴백에서 여러 단어 이름 보존", () => {
    const r = parseRecipientGrid("John Smith jsmith@x.com");
    expect(r.rows).toEqual([{ email: "jsmith@x.com", name: "John Smith" }]);
  });

  it("이메일만 있는 줄도 처리 (이름 없음)", () => {
    const r = parseRecipientGrid("solo@a.com");
    expect(r.rows).toEqual([{ email: "solo@a.com" }]);
  });

  it("이메일 없는 줄은 ignored, 이메일 소문자 정규화", () => {
    const r = parseRecipientGrid("Hong@A.com\n그냥 텍스트 줄");
    expect(r.rows).toEqual([{ email: "hong@a.com", name: undefined }]);
    expect(r.ignored).toHaveLength(1);
    expect(r.ignored[0].line).toContain("그냥 텍스트");
  });

  it("이메일 기준 중복 제거 (첫 이름 보존)", () => {
    const r = parseRecipientGrid("홍길동\thong@a.com\nHong\tHONG@a.com");
    expect(r.rows).toEqual([{ email: "hong@a.com", name: "홍길동" }]);
    expect(r.duplicates).toEqual(["hong@a.com"]);
  });

  it("형식오류 이메일은 ignored", () => {
    const r = parseRecipientGrid("홍길동\tnot-an-email");
    expect(r.rows).toEqual([]);
    expect(r.ignored).toHaveLength(1);
  });

  it("한 줄에 이메일 여러 개 → 각각 한 행 (손실 없음)", () => {
    const r = parseRecipientGrid("a@b.com c@d.com");
    expect(r.rows).toEqual([{ email: "a@b.com" }, { email: "c@d.com" }]);
  });

  it("탭 구분에 이메일 2개여도 둘 다 보존 (이름은 모호하면 생략)", () => {
    // The tab-joined 'Alice <alice@a.com>' cell gets the angle-name, and the extra email isn't lost either.
    const r = parseRecipientGrid("Alice <alice@a.com>\tbob@b.com");
    expect(r.rows.map((x) => x.email).sort()).toEqual(["alice@a.com", "bob@b.com"]);
  });

  it("빈 입력 → 빈 결과", () => {
    const r = parseRecipientGrid("");
    expect(r.rows).toEqual([]);
    expect(r.ignored).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });

  it("CRLF 줄바꿈 처리", () => {
    const r = parseRecipientGrid("홍길동\thong@a.com\r\n김철수\tkim@b.com");
    expect(r.rows).toEqual([
      { email: "hong@a.com", name: "홍길동" },
      { email: "kim@b.com", name: "김철수" },
    ]);
  });
});

describe("parseRecipients — 기존 동작 회귀 보장 (이메일만)", () => {
  it("기존 이메일 추출은 그대로 동작 (유효 이메일 보존)", () => {
    const r = parseRecipients("a@b.com, x <c@d.com>; bad");
    expect(r.valid.sort()).toEqual(["a@b.com", "c@d.com"]);
    expect(r.invalid).toContain("bad");
  });
});

describe("setNameInText — 미리보기 인라인 이름 수정", () => {
  it("이메일이 든 줄의 이름을 교체", () => {
    const out = setNameInText("홍길동\thong@a.com\nkim@b.com", "hong@a.com", "길동");
    expect(parseRecipientGrid(out).rows).toEqual([
      { email: "hong@a.com", name: "길동" },
      { email: "kim@b.com" },
    ]);
  });

  it("이름 없던 줄에 이름 부여", () => {
    const out = setNameInText("kim@b.com", "kim@b.com", "김철수");
    expect(parseRecipientGrid(out).rows).toEqual([{ email: "kim@b.com", name: "김철수" }]);
  });

  it("이름을 빈값으로 지우면 이메일만 남는다", () => {
    const out = setNameInText("홍길동\thong@a.com", "hong@a.com", "");
    expect(parseRecipientGrid(out).rows).toEqual([{ email: "hong@a.com" }]);
  });

  it("한 줄 다중 이메일은 한 명당 한 줄로 풀어쓰고 대상만 변경", () => {
    const out = setNameInText("a@b.com c@d.com", "c@d.com", "씨디");
    expect(parseRecipientGrid(out).rows).toEqual([
      { email: "a@b.com" },
      { email: "c@d.com", name: "씨디" },
    ]);
  });

  it("못 찾으면 원문 유지", () => {
    expect(setNameInText("a@b.com", "x@y.com", "X")).toBe("a@b.com");
  });
});
