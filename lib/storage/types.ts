/**
 * 자산(이미지) 스토리지 추상화 — 어댑터 인터페이스.
 *
 * 스토리지 백엔드(Azure Blob / S3 / R2 / 로컬 디스크 …)는 이 인터페이스만
 * 구현하면 된다. 어느 백엔드를 쓸지는 `brand.config.ts`의 `assets.provider`
 * 한 값으로 고른다. 새 스토리지 추가 절차는 docs/WHITELABEL.md 참고.
 *
 * ⚠️ 어댑터는 "검증이 끝난" 버퍼만 받는다. 이미지 형식 검증(magic-bytes·허용형식·
 *    용량 상한)은 provider 무관 공통 로직(lib/storage/image-validation.ts)에서
 *    선행 처리되며, 어댑터는 저장과 공개 URL 반환에만 집중한다.
 */
export interface StorageAdapter {
  /** 어댑터 식별자 (로깅·에러 메시지용). */
  readonly name: string;

  /**
   * 검증된 이미지 버퍼를 저장하고 공개적으로 접근 가능한 URL을 반환.
   * @param data      이미지 바이트
   * @param contentType  확정된 MIME 타입 (예: "image/png")
   * @param ext       확장자 (점 없음, 예: "png")
   */
  put(data: Buffer, contentType: string, ext: string): Promise<string>;
}
