import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { stripComments } from "@/lib/testing/source-span";

// ============================================================================
// THE THREE RULES `usePendingPicture` EXISTS TO HOLD (P-024, #617 review).
//
// SOURCE-SHAPED, and not by preference. This repo has no React test renderer —
// no testing-library, no jsdom — so a hook's runtime behaviour cannot be
// exercised here, and adding a DOM to the test lane to assert three lines would
// cost every future run of it. What these rules have in common is that each is a
// SHAPE: a cleanup effect that exists, a side effect that is not where it must
// not be, a catch that is present. A scan can hold all three, and each of them
// was violated in the code this hook replaced.
//
// The behaviour these shapes protect is proven where it can be: both surfaces
// are exercised by hand on the preview, and the underlying upload/remove path
// has `scripts/prove-avatar-roundtrip.ts` against the real bucket.
// ============================================================================

const SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/use-pending-picture.ts"),
  "utf8"
);
const CODE = stripComments(SOURCE);

test("an object URL is revoked at unmount, not only on the next transition", () => {
  // `URL.createObjectURL` pins its blob for the life of the DOCUMENT. The
  // settings modal's common path is upload, close, unmount — so without a
  // cleanup, up to 3MB stays pinned until the tab closes, and nothing on screen
  // ever shows it. This was missing from BOTH copies before the hook existed.
  assert.match(
    CODE,
    /useEffect\(\s*\(\)\s*=>\s*\{\s*return\s*\(\)\s*=>\s*\{[\s\S]*?revokeObjectURL/,
    "the unmount cleanup is gone — every object URL this hook creates now outlives the component that made it"
  );
});

test("the revoke is NOT performed inside a state updater", () => {
  // React requires updaters to be pure and double-invokes them in StrictMode.
  // The original did the revoke inside `setPending(current => …)`, which worked
  // only because revoking twice happens to be harmless — not a property the
  // next edit inherits.
  const updaterBodies = [
    ...CODE.matchAll(/set[A-Z]\w*\(\s*\(\w+\)\s*=>\s*\{([\s\S]*?)\n\s*\}\)/g),
  ].map(([, body]) => body);

  for (const body of updaterBodies) {
    assert.equal(
      /revokeObjectURL/.test(body),
      false,
      `a state updater performs the revoke:\n${body}\nKeep the live URL in a ref and revoke in the caller — an updater must be pure`
    );
  }
});

test("a rejected action is still answered", () => {
  // A dropped connection or a body-less 500 rejects the promise inside the
  // transition. Without a catch the spinner clears and the reader is told
  // nothing at all — the one failure mode that looks like success.
  const transition = CODE.slice(CODE.indexOf("startTransition("));

  assert.match(
    transition,
    /\} catch \{/,
    "the transition swallows a rejection — every path out of it must set a message"
  );
  assert.match(
    transition,
    /\} finally \{[\s\S]*?setInFlight\(null\)/,
    "the spinner must clear on every path, including the rejected one"
  );
});

test("one control uses this hook, and the surfaces go through it", () => {
  // The point of the hook, now enforced one level up. #617 shared the LOGIC and
  // left the two controls' markup as near-clones; #654 merged the markup too,
  // so `PictureField` is the single consumer and the two surfaces are wiring.
  //
  // Both halves are asserted, because either one alone rots. Without the first,
  // the shared control could roll its own preview state; without the second, a
  // surface could go back to hand-rolling a whole control beside it.
  const control = readFileSync(
    path.join(process.cwd(), "src/components/picture-field.tsx"),
    "utf8"
  );

  assert.match(
    control,
    /usePendingPicture/,
    "picture-field.tsx rolled its own preview state again"
  );

  for (const relative of [
    "src/components/settings/avatar-field.tsx",
    "src/components/people/person-photo-field.tsx",
  ]) {
    const component = readFileSync(path.join(process.cwd(), relative), "utf8");

    assert.match(
      component,
      /PictureField/,
      `${relative} must render the shared control, not a second copy of it`
    );
  }

  // Nobody in the picture control makes an object URL — the hook owns creating
  // and revoking them as one pair, and a second creator is a leak it cannot
  // see. Scoped to these three files rather than the tree: `export-button`,
  // `import-wizard` and `article-actions` all mint one to hand the reader a
  // FILE, which is a different job with a different lifetime.
  for (const relative of [
    "src/components/picture-field.tsx",
    "src/components/settings/avatar-field.tsx",
    "src/components/people/person-photo-field.tsx",
  ]) {
    const component = readFileSync(path.join(process.cwd(), relative), "utf8");

    assert.equal(
      /createObjectURL/.test(stripComments(component)),
      false,
      `${relative} creates an object URL outside the hook, which owns revoking them`
    );
  }
});
