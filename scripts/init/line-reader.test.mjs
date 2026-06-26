// scripts/init/line-reader.test.mjs — Unit tests for createLineReader
// Uses a fake readline-like EventEmitter so no real stdin is needed.

import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { createLineReader } from "./line-reader.mjs";

// Minimal fake that looks like a readline.Interface: just an EventEmitter with .on("line", ...)
function makeFakeRl() {
  return new EventEmitter();
}

describe("createLineReader", () => {
  let rl;
  let reader;

  beforeEach(() => {
    rl = makeFakeRl();
    reader = createLineReader(rl);
  });

  // (a) buffered line delivered to a later nextLine()
  it("buffers a line that arrives before nextLine() is called", async () => {
    // Emit BEFORE anyone calls nextLine()
    rl.emit("line", "hello");

    // Now call nextLine() — should resolve immediately from the buffer.
    const result = await reader.nextLine();
    expect(result).toBe("hello");
  });

  // (b) waiter resolves when a line arrives after nextLine() is called
  it("resolves a pending nextLine() when a line arrives later", async () => {
    const promise = reader.nextLine();
    // Emit after the waiter is registered
    rl.emit("line", "world");
    const result = await promise;
    expect(result).toBe("world");
  });

  // (c) REGRESSION: after cancel() on a pending cancelable read, the subsequently
  //     emitted line is delivered to the NEXT nextLine() — not swallowed.
  it("cancel() does not swallow the next line — regression test for theme-race bug", async () => {
    // 1. Start a cancelable read (simulates the theme terminal-input race leg)
    const { cancel } = reader.nextLineCancelable();

    // 2. Browser pick wins — cancel the terminal read BEFORE any line arrives
    cancel();

    // 3. Register the NEXT prompt's nextLine() (simulates "지금 발송도 설정할까요?")
    const nextPromise = reader.nextLine();

    // 4. User types the answer to the next question
    rl.emit("line", "n");

    // 5. That answer must be delivered to nextPromise, NOT lost
    const result = await nextPromise;
    expect(result).toBe("n");
  });

  // Extra: multiple lines buffered and consumed in FIFO order
  it("delivers buffered lines in FIFO order", async () => {
    rl.emit("line", "first");
    rl.emit("line", "second");
    rl.emit("line", "third");

    expect(await reader.nextLine()).toBe("first");
    expect(await reader.nextLine()).toBe("second");
    expect(await reader.nextLine()).toBe("third");
  });

  // Extra: cancel BEFORE awaiting — on an already-buffered item — puts it back
  it("cancel() before await on a buffered cancelable read returns the line to the buffer", async () => {
    rl.emit("line", "buffered");

    const { cancel } = reader.nextLineCancelable();
    // cancel synchronously before the deferred promise fires
    cancel();

    // The buffered line should now be available to the next nextLine()
    const result = await reader.nextLine();
    expect(result).toBe("buffered");
  });

  // REGRESSION (piped-all-at-once): cancel AFTER awaiting (line already consumed) must NOT
  // re-buffer the line. This mirrors the real scenario: theme number "2" is buffered when
  // all piped lines arrive before server.listen fires; we await the cancelable promise to get
  // "2", then finish() calls cancel() — "2" must NOT appear again for the next nextLine().
  it("cancel() after await on a buffered cancelable read does NOT re-buffer the line", async () => {
    rl.emit("line", "consumed");
    rl.emit("line", "next-answer");

    const { promise, cancel } = reader.nextLineCancelable();
    // Await first so the line is consumed
    const ans = await promise;
    expect(ans).toBe("consumed");

    // Now cancel (simulates finish() calling cancel after terminal input won the race)
    cancel();

    // The next nextLine() must get "next-answer", not "consumed" again
    const result = await reader.nextLine();
    expect(result).toBe("next-answer");
  });

  // Extra: trim whitespace on lines
  it("trims whitespace from incoming lines", async () => {
    rl.emit("line", "  trimmed  ");
    expect(await reader.nextLine()).toBe("trimmed");
  });

  // Extra: two concurrent nextLine() calls each get their own line in order
  it("two pending waiters each get one line in order", async () => {
    const p1 = reader.nextLine();
    const p2 = reader.nextLine();

    rl.emit("line", "line-one");
    rl.emit("line", "line-two");

    expect(await p1).toBe("line-one");
    expect(await p2).toBe("line-two");
  });

  // Extra: canceling one of many waiters skips it and gives next line to the next active waiter
  it("canceled waiter is skipped; next active waiter gets the line", async () => {
    const { cancel } = reader.nextLineCancelable();
    const p2 = reader.nextLine();

    cancel();
    rl.emit("line", "goes-to-p2");

    expect(await p2).toBe("goes-to-p2");
  });
});
