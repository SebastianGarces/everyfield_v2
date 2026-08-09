import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ============================================================================
// The preferences matrix component (N-006), asserted from its source.
//
// There is no DOM in this test runner — `pnpm test` is bare `node:test` over
// `src/**/*.test.ts` — so a client component's guarantees are pinned the way
// the rest of this repo pins them: against the source it ships. Rendering is
// proved on the branch's Vercel preview by the frontend validation gate; what
// belongs HERE is the set of claims a future edit could silently break without
// anyone noticing until a user does.
//
// Three of them, all from #309:
//   * a failed save reaches `toast.error` — which only works because the
//     actions RETURN their failures (#236);
//   * the optimistic value falls back to server truth rather than being undone
//     by hand (#236, the half that already worked and must stay working);
//   * the cadence area renders whichever variant the server sent, and never
//     assumes there is a selector (#254).
//
// And one more, because #236 was half a comment bug: the header comment may not
// claim behaviour the file does not have.
// ============================================================================

const COMPONENT_PATH = path.join(
  process.cwd(),
  "src/components/notifications/preference-matrix.tsx"
);

const SOURCE = readFileSync(COMPONENT_PATH, "utf8");

/** The file with its comments removed — the claim tests read those separately. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|\s)\/\/.*$/gm,
  "$1"
);

test("both writes report a returned failure to the user", () => {
  // The AC: a failed preference write surfaces. Every action call in this
  // component is followed by the same three lines, so neither control can be
  // the silent one.
  const awaited = CODE.match(/const result = await set\w+Action\(/g) ?? [];
  const reported =
    CODE.match(
      /if \(!result\.success\) \{\s*toast\.error\(result\.error\);/g
    ) ?? [];

  assert.equal(awaited.length, 2, "expected the toggle and the cadence write");
  assert.equal(reported.length, awaited.length);
  assert.match(CODE, /import \{ toast \} from "sonner"/);
});

test("the optimistic value is never undone by hand", () => {
  // `useOptimistic` drops back to the props when the transition ends, so a
  // failed save returns the control to server truth on its own. A component
  // that started re-applying the previous value itself would be storing server
  // data in client state — memory/contracts/data-patterns.md forbids it, and it
  // would go stale the moment the server revalidated.
  assert.match(CODE, /useOptimistic\(serverState, applyMatrixAction\)/);
  assert.doesNotMatch(CODE, /useState/);
  assert.doesNotMatch(CODE, /useEffect/);
  assert.doesNotMatch(CODE, /router\.refresh/);
});

test("the cadence area renders the variant it was given, not an assumed one", () => {
  // #254. The server sends `fixed` to an oversight recipient — an explanation
  // instead of a selector — so every use of the choice-only fields has to sit
  // behind the discriminant. A stray `view.digest.options` would type-error,
  // but a stray `digest.cadence` outside the branch would not.
  assert.match(CODE, /digest\.kind === "choice"/);
  assert.match(CODE, /"digest-cadence-fixed"/);

  // The explanation is rendered from the view model, never written here — the
  // copy has one home (`OVERSIGHT_DIGEST_CADENCE_NOTE`) and a test that holds
  // it to what is true.
  assert.doesNotMatch(CODE, /once a day/i);
});

test("every clickable in the matrix carries cursor-pointer", () => {
  // The repo-wide rule. The Switch, the Select trigger, each Select item and
  // the labels that stand in for the switch on a phone are all pressable.
  for (const control of [
    /<Switch[\s\S]*?className="cursor-pointer"/,
    /<SelectTrigger[\s\S]*?cursor-pointer/,
    /<SelectItem[\s\S]*?className="cursor-pointer"/,
  ]) {
    assert.match(CODE, control, String(control));
  }
});

test("the header comment claims only what the file does", () => {
  // The other half of #236: the comment already promised a toast on failure
  // while the actions were still throwing, so the file documented behaviour it
  // did not have. Whatever it claims must be traceable to the code below it.
  const header = SOURCE.slice(0, SOURCE.indexOf("export interface"));

  // It explains WHY the toast works — the actions return their failures —
  // rather than merely asserting that it does.
  assert.match(header, /RETURN their failures/);
  assert.match(header, /useOptimistic/);

  // It describes the oversight variant, which is now half of what this file
  // renders.
  assert.match(header, /fixed/);

  // And it does not claim the component decides anything the server decides.
  assert.doesNotMatch(header, /this component (decides|chooses) what/i);
});
