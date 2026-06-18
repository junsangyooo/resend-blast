import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm space-y-6 shadow-2xl text-center">
        <div>
          <div className="kicker">404</div>
          <h1 className="mt-1 text-xl font-semibold">페이지를 찾을 수 없어요</h1>
          <p className="mt-2 text-[12px] text-muted">
            주소가 잘못되었거나 더 이상 존재하지 않는 페이지입니다.
          </p>
        </div>
        <Link
          href="/"
          className="inline-block w-full rounded-lg bg-white text-black text-sm font-medium py-2.5 hover:opacity-90 transition"
        >
          메인으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
