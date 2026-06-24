/**
 * File I/O helpers: atomic write (tmp → rename) + serializing mutex within a single process.
 * - atomicWrite: prevents JSON corrupted by partial writes. tmp must be in the same directory for rename to be atomic.
 * - withFileLock: serializes read-modify-write for the same key. Prevents concurrent-request collisions.
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

/** Try to parse JSON. On failure, preserve the file as a backup (.bak) and return the fallback. */
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
