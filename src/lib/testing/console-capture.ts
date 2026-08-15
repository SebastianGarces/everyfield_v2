/**
 * CAPTURE `console.warn` / `console.error`, SO A CHANNEL ASSERTION IS A REAL
 * ASSERTION.
 *
 * A test that says "a clock problem must not page anyone" is really a claim
 * about WHICH CHANNEL a run wrote to. Left uncaptured that claim cannot be
 * made at all: the lines go to the runner's own stdout, the suite asserts
 * nothing, and a failure that moves from `warn` to `error` is invisible.
 *
 * It lives here for the same reason `source-span.ts` does — it names no domain,
 * imports none, and could not be made to. Chosen once, so the next suite that
 * needs it imports this instead of pasting a fourth copy of the same six lines.
 *
 * `restore()` belongs in a `finally`: an assertion that throws while the
 * console is still swapped takes the runner's own reporting down with it.
 */
export interface ConsoleCapture {
  /** Every `console.warn` call, arguments joined by a space. */
  readonly warns: string[];
  /** Every `console.error` call, arguments joined by a space. */
  readonly errors: string[];
  /** Put the real `console.warn` / `console.error` back. */
  restore(): void;
}

export function captureConsole(): ConsoleCapture {
  const warns: string[] = [];
  const errors: string[] = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: unknown[]) => warns.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  return {
    warns,
    errors,
    restore() {
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}
