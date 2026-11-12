/**
 * Next.js 서버 부팅 시 1회 실행되는 hook (Next 14 는 next.config 의 experimental.instrumentationHook 필요).
 * 실제 작업은 lib/boot.ts — NEXT_RUNTIME 조건 블록 안에서만 import 해야 Edge 번들에서 빠진다
 * (early return 형태로 쓰면 webpack 이 fs 를 Edge 용으로도 해석하려다 빌드가 깨진다).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { boot } = await import("./lib/boot");
    await boot();
  }
}
