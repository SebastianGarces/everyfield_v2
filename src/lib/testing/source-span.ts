/**
 * SPANS OF SOURCE, WITH A LOUD FAILURE WHEN AN ANCHOR MOVES.
 *
 * Some suites assert on the SOURCE of a function rather than on its behaviour —
 * a call graph, an ordering, a className — because the subject is a client
 * component or a `"use server"` module that a unit test's process cannot
 * execute. Every one of them starts by cutting the function out of its file
 * with `indexOf`, and that is where they rot:
 *
 *   * `String.indexOf` returns -1 for a needle that is no longer there;
 *   * `slice(start, -1)` then returns almost the WHOLE FILE instead of the
 *     function under test, and `slice(-1)` the last character;
 *   * `slice(-1, end)` returns the EMPTY STRING whenever `end` is anywhere but
 *     the very tail — and `assert.doesNotMatch("", /X/)` is a TAUTOLOGY;
 *   * so an `assert.doesNotMatch(fn, /X/)` becomes a module-wide claim that
 *     passes by luck or a claim about nothing at all, and an
 *     `assert.match(fn, /X/)` keeps passing off some OTHER function's copy
 *     of `X`.
 *
 * Every one of those failures is silent, and all three found so far happened in
 * `src/lib/invitations/`, which is why the enforcement below still scans only
 * that directory (see "WHERE THIS LIVES, AND WHAT IT GUARDS" at the end).
 * OV-003b (#293) reworded `createInvitationAs`'s docblock to say "+ send" and
 * killed the end anchor of `invite-rate-limit.test.ts`'s post-resolution guard;
 * #304 ruling 4 item 5 deleted `CopyInviteLinkButton` and killed the end anchor
 * of `resend.test.ts`'s action-cluster test; and `invitations-ui.test.ts`
 * anchored on `async function createAccountEntities` for a function that is
 * synchronous, so that needle had NEVER matched — one span was the empty string
 * and, four hundred lines later, the same dead needle made the `register` body
 * 93% of its module. No suite went red for any of the three. A source-shaped
 * test has to fail on its own subject or not at all — so nothing in the
 * invitations domain slices source by hand any more; it goes through a reader,
 * and a moved anchor THROWS.
 *
 * ORDERING GOES THROUGH IT TOO, and that half needs no slice to bite. An
 * `assert.ok(span.indexOf(A) < span.indexOf(B))` is the same rot one level up:
 * delete `A`, `indexOf` returns -1, `-1 < N` is TRUE, and the assertion goes
 * green on a subject that no longer exists. No slice is involved, so a reader
 * that only owns spans never sees it — which is why `assertInOrder` below
 * resolves every needle through the same throw-on-missing lookup BEFORE it
 * compares them. Passing today is not the property; failing tomorrow is.
 *
 * Both halves are checkable rather than aspirational, and they ARE checked —
 * the first sweep closed the slicing half and recorded the closure as total
 * while nine vacuous orderings sat in the same suites, so the rule is no longer
 * left to prose. `source-span.test.ts` reads every `*.test.ts` under
 * `src/lib/invitations/` and fails on a bare `.indexOf(` outside a four-line
 * allowlist of sites that HANDLE -1 in a branch right there. A bare `indexOf`
 * reaches neither a `slice` nor a `<`.
 *
 * Anchor on a DECLARATION (`export async function foo`, `const bar`,
 * `interface Baz`), never on a comment: a docblock is prose, prose gets
 * reworded, and that is how both of the above broke.
 *
 * WHERE THIS LIVES, AND WHAT IT GUARDS — two different questions.
 *
 * `src/lib/testing/` is this repo's home for test-only infrastructure that is
 * ABOUT no feature: nothing in this file names a domain, imports one, or could
 * be made to. Chosen once, here, so the next domain that needs a source-shaped
 * test imports it instead of pasting a second copy — a duplicated decision is
 * the exact failure the sweep that produced this module spent its effort
 * deleting. (Contrast `src/lib/auth/server-action-surface.ts`, also test-only
 * but genuinely about auth, so it sits with the module that owns sessions.)
 *
 * The GUARD in `source-span.test.ts` is narrower than the helper on purpose. It
 * scans `src/lib/invitations/` only, because that is the directory that has
 * actually been converted; the rest of the repo still has bare `indexOf`
 * anchors and converting them is separate work. Widen the scan when a directory
 * is converted, never before — a guard that fails on unconverted code gets
 * disabled, and a disabled guard checks nothing.
 *
 * Nothing here is imported by application code — it is for tests and scripts.
 */

/** `" — why"`, or nothing when the caller gave no reason. */
function reason(because: string | undefined): string {
  return because ? ` — ${because}` : "";
}

/**
 * The position of `needle`, or a throw naming both the file and the needle.
 *
 * The single place -1 is turned into a failure. Every span, every tail and
 * every ordering in this module goes through it, which is what makes "a moved
 * anchor throws" one rule instead of three.
 */
function indexOfAnchor(
  code: string,
  label: string,
  needle: string,
  because?: string
): number {
  const index = code.indexOf(needle);

  if (index === -1) {
    throw new Error(`${label} no longer contains: ${needle}${reason(because)}`);
  }

  return index;
}

/**
 * Assert that `needles` appear in `source` in the order given, strictly.
 *
 * The ordering counterpart of `span`/`after`, and the only sanctioned way to
 * assert an order in this domain. It resolves each needle first, so a needle
 * that has been deleted or renamed FAILS here instead of comparing -1 against
 * a real position and passing.
 *
 * `label` names the file a failure should be grepped in, exactly as it does for
 * `sourceReader`. `because` is the sentence the old `assert.ok(a < b, "…")`
 * carried; it is appended to BOTH failure messages, because "this anchor is
 * gone" and "these two swapped" need the same explanation of why the order was
 * load-bearing. It is last, which is why `needles` is an array rather than a
 * rest parameter.
 *
 * Positions are FIRST occurrences, like `span`, so anchor on text that occurs
 * once — a call with its `await`, a declaration — not on a bare identifier the
 * surrounding comments also use.
 */
export function assertInOrder(
  source: string,
  label: string,
  needles: readonly string[],
  because?: string
): void {
  if (needles.length < 2) {
    throw new Error(
      `${label}: assertInOrder needs at least two needles${reason(because)}`
    );
  }

  let previousIndex = -1;
  let previousNeedle = "";

  for (const needle of needles) {
    const index = indexOfAnchor(source, label, needle, because);

    if (previousIndex !== -1 && index <= previousIndex) {
      throw new Error(
        `${label}: "${needle}" must follow "${previousNeedle}"${reason(because)}`
      );
    }

    previousIndex = index;
    previousNeedle = needle;
  }
}

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
    return indexOfAnchor(code, label, needle);
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
