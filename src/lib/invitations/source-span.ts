/**
 * SPANS OF SOURCE, WITH A LOUD FAILURE WHEN AN ANCHOR MOVES.
 *
 * Several suites in this domain assert on the SOURCE of a function rather than
 * on its behaviour — a call graph, an ordering, a className — because the
 * subject is a client component or a `"use server"` module that a unit test's
 * process cannot execute. Every one of them starts by cutting the function out
 * of its file with `indexOf`, and that is where they rot:
 *
 *   * `String.indexOf` returns -1 for a needle that is no longer there;
 *   * `slice(start, -1)` then returns almost the WHOLE FILE instead of the
 *     function under test, and `slice(-1)` the last character;
 *   * so an `assert.doesNotMatch(fn, /X/)` becomes a module-wide claim that
 *     passes by luck, and an `assert.match(fn, /X/)` keeps passing off some
 *     OTHER function's copy of `X`.
 *
 * Both failures are silent, and both have happened here. OV-003b (#293) reworded
 * `createInvitationAs`'s docblock to say "+ send" and killed the end anchor of
 * `invite-rate-limit.test.ts`'s post-resolution guard; #304 ruling 4 item 5
 * deleted `CopyInviteLinkButton` and killed the end anchor of `resend.test.ts`'s
 * action-cluster test. Neither suite went red. A source-shaped test has to fail
 * on its own subject or not at all — so nothing in this domain slices source by
 * hand any more; it goes through a reader, and a moved anchor THROWS.
 *
 * Anchor on a DECLARATION (`export async function foo`, `const bar`,
 * `interface Baz`), never on a comment: a docblock is prose, prose gets
 * reworded, and that is how both of the above broke.
 *
 * Nothing here is imported by application code — it is for tests and scripts,
 * like `src/lib/auth/server-action-surface.ts`.
 */

/** A source file, plus the two ways to cut a declaration out of it. */
export interface SourceReader {
  /** The whole file, for the assertions that are genuinely module-wide. */
  readonly code: string;
  /**
   * From `from` up to (not including) `to`. Throws when either anchor is
   * missing, or when they are in the wrong order.
   */
  span(from: string, to: string): string;
  /**
   * From `from` to the end of the file — for a declaration that is genuinely
   * last. Throws when the anchor is missing.
   */
  after(from: string): string;
}

/**
 * Bind the readers to one file's source. `label` is what a failure names, so
 * pass the path a reader would grep for (`"core.ts"`, `"invitations-list.tsx"`),
 * and say so when the source has been transformed — a stripped copy and the
 * original fail for different reasons.
 */
export function sourceReader(code: string, label: string): SourceReader {
  function at(needle: string): number {
    const index = code.indexOf(needle);

    if (index === -1) {
      throw new Error(`${label} no longer contains: ${needle}`);
    }

    return index;
  }

  return {
    code,

    span(from: string, to: string): string {
      const start = at(from);
      const end = at(to);

      if (end <= start) {
        throw new Error(`${label}: "${to}" must follow "${from}"`);
      }

      return code.slice(start, end);
    },

    after(from: string): string {
      return code.slice(at(from));
    },
  };
}
