/**
 * Hook that runs once at Next.js server boot (Next 14 needs experimental.instrumentationHook in next.config).
 * The real work is in lib/boot.ts — it must be imported only inside the NEXT_RUNTIME conditional block to stay out of the Edge bundle
 * (written as an early return, webpack tries to resolve fs for Edge too and the build breaks).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { boot } = await import("./lib/boot");
    await boot();
  }
}
