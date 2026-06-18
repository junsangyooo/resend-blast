/**
 * 파일 I/O 헬퍼: atomic write(tmp → rename) + 단일 프로세스 내 직렬화 mutex.
 * - atomicWrite: 부분 쓰기로 손상된 JSON 방지. tmp는 같은 디렉토리에 만들어야 rename이 atomic.
 * - withFileLock: 같은 키의 read-modify-write를 직렬화. 동시 요청 충돌 방지.
 */
import fs from "fs/promises";
import path from "path";

export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

const locks = new Map<string, Promise<unknown>>();
export function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

/** JSON 파싱 시도. 실패하면 백업 파일(.bak)로 보존하고 fallback 반환. */
export async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
      return JSON.parse(raw) as T;
    } catch {
      const bak = `${filePath}.${Date.now()}.corrupt.bak`;
      await fs.rename(filePath, bak).catch(() => {});
      return fallback;
    }
  } catch {
    return fallback;
  }
}
