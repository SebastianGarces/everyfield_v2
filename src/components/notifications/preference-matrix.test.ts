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

// ----------------------------------------------------------------------------
// Rows the reader is never served (ruled 2026-08-09, extending #254)
//
// The row stays, carries a token, and its switches are inert. What belongs here
// is the set of claims a future edit could break silently: that "inert" is real
// rather than cosmetic, that the reason is on the SCREEN and not only in a
// tooltip, and that none of it is driven by a list of category names.
// ----------------------------------------------------------------------------

test("an ineligible row's switches are genuinely inert, not merely greyed", () => {
  // The whole point of the ruling. A switch that still saved would be the
  // defect it closes — the cadence control #254 retired, one row up.
  assert.match(CODE, /disabled=\{ineligible\}/);

  // And the handler refuses too, so a programmatic `onCheckedChange` cannot do
  // what the pointer cannot. The server action is the lock that matters; this
  // is the one that keeps the optimistic value from moving for a save that is
  // going to be refused.
  assert.match(
    CODE,
    /if \(ineligibleCategories\.has\(cell\.category\)\) return;/
  );
});

test("an ineligible row reads OFF, whatever its coded default resolves to", () => {
  // The switch answers "will this reach me?". For these five the answer is no
  // however the preference resolves — `enqueue` refuses them before a
  // preference is consulted — so a switch drawn ON beside "Not sent to you"
  // would restate the contradiction the ruling closes.
  assert.match(
    CODE,
    /checked=\{ineligible \? false : state\.cells\[cell\.key\]\}/
  );

  // It is a rendering and nothing more: resolution still reports what it found,
  // so `data-source` does not start lying to make the switch agree with it.
  assert.match(CODE, /data-source=\{cell\.source\}/);
});

test("the reason is on the screen, not only in a tooltip", () => {
  // A `title` is invisible to touch, to keyboard users and to anyone who does
  // not hover. It may REPEAT the reason for a reader who lands on a later row;
  // it may not be the only place the reason exists.
  assert.match(CODE, /\{view\.ineligibleNote\}/);
  assert.match(CODE, /data-testid="preference-ineligible-note"/);

  // Said once for the group, and pointed at by every inert switch — so a screen
  // reader on any of them hears what arrives instead.
  assert.match(CODE, /row\.category === firstIneligible/);
  assert.match(
    CODE,
    /aria-describedby=\{\s*ineligible \? ineligibleNoteId : undefined\s*\}/
  );
});

test("nothing in the matrix names a category, a role or an audience", () => {
  // Eligibility arrives as `row.eligible`, resolved on the server from
  // `OVERSIGHT_ELIGIBLE_CATEGORIES`. A component that knew the five granular
  // names — or knew what a `network_admin` is — would be a second copy of the
  // allow-list, and the copy is always the one that misses the next change.
  for (const forbidden of [
    /"tasks"/,
    /"meetings"/,
    /"communication"/,
    /"teams"/,
    /"phase"/,
    /"milestones"/,
    /network_admin/,
    /sending_church_admin/,
    /oversight/i,
  ]) {
    assert.doesNotMatch(CODE, forbidden, String(forbidden));
  }
});

test("the token is short, and the reason it abbreviates is not written here", () => {
  // The token answers "can I use this?" in four words beside the category name.
  // The reason answers "then what do I get?" and is a sentence, which is why it
  // is said once rather than five times — and why it lives in the view model
  // with the refusal the write path returns, not in this file.
  const token = CODE.match(/<Badge[\s\S]*?>\s*([^<]+?)\s*<\/Badge>/)?.[1] ?? "";

  assert.equal(token, "Not sent to you");
  assert.ok(token.split(/\s+/).length <= 4, "the token must stay glanceable");
  assert.doesNotMatch(CODE, /milestones and the daily summary/i);
});

test("no prototype scaffolding survives the ruling", () => {
  // Three presentations shipped together to be operated on the preview. The
  // switcher never ships as live UI, and the losing two are gone rather than
  // parked behind a flag.
  assert.doesNotMatch(SOURCE, /PROTOTYPE/);
  assert.doesNotMatch(
    SOURCE,
    /prototype-switcher|oversight-eligibility-prototype/
  );
});
