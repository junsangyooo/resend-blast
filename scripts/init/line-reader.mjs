// scripts/init/line-reader.mjs — Cancelable buffered line reader over readline
//
// Why: The readline async-iterator approach (rl[Symbol.asyncIterator]()) leaves a
// pending .next() call when the theme-step races a browser pick vs terminal input.
// If the browser wins and the terminal .next() is never resolved, the NEXT caller
// of nextLine() loses that future line because the dangling .next() will receive it.
//
// This module replaces the iterator with a FIFO buffer + waiter queue driven by
// rl.on("line", ...). It supports:
//   nextLine()           — resolves with the next buffered or future line
//   nextLineCancelable() — returns { promise, cancel }; cancel() removes the waiter
//                          WITHOUT consuming the line it would have received.

/**
 * @param {import("node:readline").Interface} rl  A readline interface
 * @returns {{ nextLine: () => Promise<string>, nextLineCancelable: () => { promise: Promise<string>, cancel: () => void } }}
 */
export function createLineReader(rl) {
  /** @type {string[]} Lines that arrived before anyone called nextLine() */
  const buffer = [];

  /** @type {Array<{ resolve: (s: string) => void, canceled: boolean }>} Pending waiters */
  const waiters = [];

  rl.on("line", (line) => {
    const trimmed = (line ?? "").trim();

    // Walk the waiter queue looking for the first non-canceled slot.
    while (waiters.length > 0) {
      const w = waiters.shift();
      if (!w.canceled) {
        w.resolve(trimmed);
        return;
      }
      // canceled waiter — discard and try next
    }

    // No active waiter — buffer the line for the next nextLine() call.
    buffer.push(trimmed);
  });

  /**
   * Resolves with the next line (buffered FIFO, or waits for the next "line" event).
   * @returns {Promise<string>}
   */
  function nextLine() {
    if (buffer.length > 0) {
      return Promise.resolve(buffer.shift());
    }
    return new Promise((resolve) => {
      waiters.push({ resolve, canceled: false });
    });
  }

  /**
   * A cancelable read. Returns { promise, cancel }.
   * Calling cancel() marks the waiter as canceled so the "line" event for that slot
   * falls through to the buffer or the NEXT real nextLine() caller — nothing is swallowed.
   * After cancel(), the very next call to nextLine() will correctly receive the next line.
   * @returns {{ promise: Promise<string>, cancel: () => void }}
   */
  function nextLineCancelable() {
    if (buffer.length > 0) {
      // Already have a buffered line — take it, but allow cancel() to put it back
      // ONLY if the promise hasn't resolved yet (i.e., the caller never awaited it).
      const line = buffer.shift();
      // State machine: "pending" → "resolved" (microtask) or "canceled" (cancel call).
      // Only one of resolved/canceled can win; whichever sets the state first wins.
      let state = "pending"; // "pending" | "resolved" | "canceled"
      const promise = new Promise((resolve) => {
        // Defer resolution by one microtask so a synchronous cancel() can win the race.
        Promise.resolve().then(() => {
          if (state === "pending") {
            state = "resolved";
            resolve(line);
          }
          // If already "canceled", do nothing — the line was put back.
        });
      });
      return {
        promise,
        cancel() {
          if (state === "pending") {
            state = "canceled";
            // Line was never delivered — put it back so the next nextLine() sees it.
            buffer.unshift(line);
          }
          // If already "resolved", the line was consumed — nothing to undo.
        },
      };
    }

    // No buffered line — register a cancelable waiter.
    const waiter = { resolve: null, canceled: false };
    const promise = new Promise((resolve) => {
      waiter.resolve = resolve;
    });
    waiters.push(waiter);

    return {
      promise,
      cancel() {
        waiter.canceled = true;
        // The "line" handler will skip this canceled waiter when the next line arrives,
        // so nothing is swallowed.
      },
    };
  }

  return { nextLine, nextLineCancelable };
}
