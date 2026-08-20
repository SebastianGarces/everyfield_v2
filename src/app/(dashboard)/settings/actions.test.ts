import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { SUPPRESSION_SELF_CLEAR_REASON } from "@/lib/notifications/channels/suppression";
import {
  loadUserPreferences,
  preferenceOwnerFromSession,
  setDigestCadenceQuery,
  setPreferenceQuery,
} from "@/lib/notifications/preferences";

// ============================================================================
// The settings screen's write path — ownership (N-006).
//
// The AC: "a user cannot read or write another user's preferences (write-path
// assertion with a foreign user id)". There are two halves to proving that, and
// this file covers both.
//
// 1. STRUCTURAL — the actions never accept a user id, so there is no foreign id
//    to supply. `src/app/(dashboard)/settings/actions.ts` is a `"use server"`
//    module: importing it here would drag `next/cache` into a bare node:test
//    process, so its shape is asserted from its source. That is the same
//    technique `preferences.test.ts` and `enqueue.test.ts` use where the
//    property lives in a place a unit test cannot call into.
//
// 2. BEHAVIOURAL — the statements those actions produce are scoped to the
//    session's own user, and a foreign id smuggled through the input is
//    discarded rather than honoured.
//
// The compile-time half — that a bare `string` is not assignable to
// `PreferenceOwner` at all — is asserted in `preferences.test.ts` with
// `@ts-expect-error`, which `pnpm typecheck` enforces.
// ============================================================================

const ACTIONS_PATH = path.join(
  process.cwd(),
  "src/app/(dashboard)/settings/actions.ts"
);

const ACTIONS_SOURCE = readFileSync(ACTIONS_PATH, "utf8");

/**
 * The module with its comments removed.
 *
 * The absence assertions below are about CODE. Without this they would also be
 * about prose, and the module's header explains the ownership rule by naming
 * the shape it forbids (`formData.get("userId")`) — so documenting the rule
 * would break the test that enforces it, and the cheapest way to keep the test
 * green would be to delete the explanation.
 */
const ACTIONS_CODE = ACTIONS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|\s)\/\/.*$/gm,
  "$1"
);

/** The session whose preferences are legitimately being edited. */
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER = preferenceOwnerFromSession({ user: { id: OWNER_ID } });

/** Someone else entirely. Nothing on this screen may ever reach them. */
const FOREIGN_ID = "22222222-2222-4222-8222-222222222222";

test("every exported settings action mints its actor from the session", () => {
  // Not "most of them". A second action added later that resolved its user any
  // other way would be the one loose write path, and that is exactly the shape
  // of bug this counts.
  //
  // The MINT is `verifySession()`. What each action does with it differs: the
  // two preference writes go on to mint a `PreferenceOwner`, which is the brand
  // their storage layer accepts; the suppression clear reads the session's own
  // ADDRESS, because a suppression is keyed by mailbox and not by user id.
  // Counting owner mints alone would have said the third action checks nobody.
  const exported = ACTIONS_CODE.match(/export async function /g) ?? [];
  const sessions =
    ACTIONS_CODE.match(/const session = await requireSeat\("[\w.]+"\)/g) ?? [];

  assert.ok(exported.length > 0, "no exported actions found — check the path");
  assert.equal(
    sessions.length,
    exported.length,
    "an exported action that does not open with the session mint is an unauthenticated endpoint"
  );

  // The owner comes from a VERIFIED session and from nothing else. Two call
  // shapes are legitimate — the mint inlined on `verifySession()`, and the mint
  // taking a `session` const the line above assigned from it, which an action
  // that also has to read the role needs. Anything else is refused by the
  // lookahead, so a mint fed from some third value fails here.
  assert.doesNotMatch(
    ACTIONS_CODE,
    /preferenceOwnerFromSession\((?!session\)|await requireSeat\("[\w.]+"\)\))/
  );

  // …and the same rule for the address: every `email:` this module writes is
  // read off the verified session, never off an argument.
  // `clearMyEmailSuppressionAction` takes none at all.
  for (const [written] of ACTIONS_CODE.matchAll(/\bemail:[^,\n}]*/g)) {
    assert.equal(
      written,
      "email: session.user.email",
      `an address reached a write as "${written}" rather than from the session`
    );
  }
});

test("every exported action returns its failures instead of throwing", () => {
  // #236. A server action that throws rejects the promise the client awaits,
  // and the rejection unwinds the transition without reaching `toast.error` —
  // the user sees the control snap back and is told nothing. So every body is
  // wrapped, and every catch hands the failure back.
  const exported = ACTIONS_CODE.match(/export async function /g) ?? [];
  const wrapped = ACTIONS_CODE.match(/\btry \{/g) ?? [];

  assert.equal(wrapped.length, exported.length);

  // Next.js control-flow errors (`redirect()`, `notFound()`, prerender
  // interrupts) are thrown as errors but MEAN something to the framework, so
  // they get first refusal in every catch. Swallowing one would turn a working
  // redirect into a false "we could not save that".
  const rethrown = ACTIONS_CODE.match(/unstable_rethrow\(error\)/g) ?? [];
  assert.equal(rethrown.length, exported.length);

  for (const block of ACTIONS_CODE.split("} catch (error) {").slice(1)) {
    const rethrowAt = block.indexOf("unstable_rethrow(error)");
    // Whichever sentence this action reports — `preferenceSaveFailure` for the
    // two preference writes, its own constant for the suppression clear — the
    // catch has to END in a returned failure rather than a rethrow of its own.
    const returnAt = block.indexOf("return ");

    assert.ok(rethrowAt >= 0, "a catch block does not rethrow control flow");
    assert.ok(returnAt >= 0, "a catch block swallows without reporting");
    assert.ok(rethrowAt < returnAt, "unstable_rethrow must come first");
  }

  // The two preference writes still share one sentence-chooser, which is where
  // "your session expired" is told apart from "the write failed".
  assert.equal(
    (ACTIONS_CODE.match(/return preferenceSaveFailure\(error\)/g) ?? []).length,
    2
  );
});

test("the cadence action refuses the roles the screen no longer offers it to", () => {
  // #254. The screen stops rendering the selector for an oversight recipient,
  // but every export of a `"use server"` module is a POSTable endpoint — so the
  // refusal lives here too, and says the same sentence the screen does.
  assert.match(
    ACTIONS_CODE,
    /audienceForTenancy\(session\.user\) === "oversight"/
  );
  assert.match(ACTIONS_CODE, /error: OVERSIGHT_DIGEST_CADENCE_NOTE/);
});

test("the toggle action refuses the categories the screen no longer offers", () => {
  // The same shape as the cadence refusal above, one row up (ruled 2026-08-09).
  // Two properties matter and both are asserted from the source, because the
  // module is `"use server"` and cannot be imported into a bare node:test.
  //
  // 1. The refusal is DERIVED. `audienceMayReceiveCategory` reads
  //    `OVERSIGHT_ELIGIBLE_CATEGORIES`, so a category added to the allow-list
  //    becomes writable here on the same deploy. A literal list of the five
  //    granular names would be a second copy to keep in step, and this test
  //    fails if one appears.
  assert.match(
    ACTIONS_CODE,
    /!audienceMayReceiveCategory\(audience, category\)/
  );
  assert.match(ACTIONS_CODE, /error: OVERSIGHT_INELIGIBLE_CATEGORY_NOTE/);

  for (const category of ["tasks", "meetings", "communication", "teams"]) {
    assert.doesNotMatch(
      ACTIONS_CODE,
      new RegExp(`"${category}"`),
      `the refusal must not name ${category} — it is derived from the allow-list`
    );
  }

  // 2. It is asked BEFORE the write, and before the no-op question. A refused
  //    category has nothing to compare against, and a refusal that arrived
  //    after `setPreference` would not be a refusal.
  const refusalAt = ACTIONS_CODE.indexOf("audienceMayReceiveCategory");
  const noopAt = ACTIONS_CODE.indexOf("preferenceWriteIsNoop");
  const writeAt = ACTIONS_CODE.indexOf("await setPreference(");

  assert.ok(refusalAt >= 0 && noopAt >= 0 && writeAt >= 0);
  assert.ok(refusalAt < noopAt, "the refusal must precede the no-op question");
  assert.ok(refusalAt < writeAt, "the refusal must precede the write");
});

test("no settings action names a user, anywhere", () => {
  // A user id in this module could only have come from the client — a form
  // field, a query string or a route param — and a preference is a consent
  // record: reading or flipping someone else's is the whole risk. The absence
  // is the assertion.
  for (const forbidden of [
    /user_id/,
    /searchParams/,
    /\bparams\b/,
    /formData/,
  ]) {
    assert.doesNotMatch(ACTIONS_CODE, forbidden, String(forbidden));
  }

  // A user id may be MENTIONED in exactly one shape: the literal `null` that
  // says a suppression clear had no admin behind it. Anything else — a
  // parameter, a field read off an argument, a value passed through — is the
  // thing this test exists to catch.
  for (const [mention] of ACTIONS_CODE.matchAll(/\w*[uU]serId[^,\n)]*/g)) {
    assert.equal(
      mention,
      "clearedByUserId: null",
      `a user id appears as "${mention}" — the only permitted mention is the self-service null`
    );
  }
});

test("the settings actions do not reach the database directly", () => {
  // Every write goes through `@/lib/notifications/preferences`, which is where
  // the `PreferenceOwner` boundary is. A raw `db.update(notificationPreferences)`
  // here would bypass it entirely while still type-checking.
  assert.doesNotMatch(ACTIONS_CODE, /from "@\/db"/);
  assert.doesNotMatch(ACTIONS_CODE, /\bdb\./);
});

test("a foreign user id in the input is discarded, not written", () => {
  // The write-path assertion the AC asks for. `setPreferenceSchema` parses at
  // the boundary and knows nothing about a user, so an extra `userId` on the
  // payload is stripped — the id in the statement is the OWNER's, minted from
  // the session, and the foreign one appears nowhere in it.
  const { params } = setPreferenceQuery(OWNER, {
    // @ts-expect-error the point of the test: a client cannot address a user
    userId: FOREIGN_ID,
    category: "tasks",
    channel: "email",
    enabled: false,
  }).toSQL();

  assert.ok(params.includes(OWNER_ID));
  assert.ok(!params.includes(FOREIGN_ID));
});

test("the cadence write is scoped to the session's own user too", () => {
  const { params } = setDigestCadenceQuery(OWNER, "daily").toSQL();

  assert.ok(params.includes(OWNER_ID));
  assert.ok(!params.includes(FOREIGN_ID));
});

test("two sessions produce two disjoint owners", () => {
  // There is no path from holding a foreign id to writing as that user, and no
  // path from a session to any id but its own: the mint is the identity
  // function on the session's user, and nothing else can produce the brand.
  const foreignOwner = preferenceOwnerFromSession({
    user: { id: FOREIGN_ID },
  });

  assert.equal(String(OWNER), OWNER_ID);
  assert.equal(String(foreignOwner), FOREIGN_ID);
  assert.notEqual(String(OWNER), String(foreignOwner));
});

test("the read path takes an owner and nothing else", () => {
  // The read half of the AC. `loadUserPreferences` has one parameter and it is
  // branded, so a page cannot ask for "the preferences of user X" — the
  // `@ts-expect-error` is the assertion, and an unused directive is itself an
  // error, so it cannot rot into a comment.
  assert.equal(loadUserPreferences.length, 1);

  // @ts-expect-error a plain string is not proof of ownership
  const call = () => loadUserPreferences(FOREIGN_ID);

  assert.equal(typeof call, "function");
});

// ============================================================================
// The bounce escape hatch (#324) — "a bounce is not a life sentence"
//
// Before this, `clearAddressSuppression` had no caller anywhere in `src/`: the
// suppression half shipped whole and the un-suppression half shipped as a
// function nobody could reach, so the only remedy for a bounced planter was an
// operator running SQL against production.
//
// The action itself is `"use server"` and cannot be imported into a bare
// node:test process, so its shape is asserted from its source — the same
// technique the ownership tests above use. What it DOES is one call to a
// function tested where it lives (`suppression.test.ts`).
// ============================================================================

const PAGE_SOURCE = readFileSync(
  path.join(process.cwd(), "src/app/(dashboard)/settings/page.tsx"),
  "utf8"
);

const NOTICE_SOURCE = readFileSync(
  path.join(
    process.cwd(),
    "src/components/notifications/email-suppression-notice.tsx"
  ),
  "utf8"
);

/** The body of the suppression action, comments stripped. */
function clearActionBody(): string {
  const from = ACTIONS_CODE.indexOf(
    "export async function clearMyEmailSuppressionAction"
  );
  assert.notEqual(
    from,
    -1,
    "the un-suppress action is gone — AC has no surface"
  );
  return ACTIONS_CODE.slice(from);
}

test("the un-suppress action accepts no arguments at all", () => {
  // Every export of a `"use server"` module is a POSTable endpoint reachable
  // with no session and no UI (memory/invariants.md → Authentication). An
  // address parameter here would be an un-suppress endpoint for anybody's
  // mailbox — a deliverability weapon pointed at the sending domain — so the
  // parameter list is empty and there is nothing to forge.
  assert.match(
    ACTIONS_CODE,
    /export async function clearMyEmailSuppressionAction\(\):/,
    "the action takes a parameter"
  );
});

test("the un-suppress action clears the session's own address and no other", () => {
  const body = clearActionBody();

  assert.match(body, /const session = await requireSeat\("[\w.]+"\)/);
  assert.match(
    body,
    /email:\s*session\.user\.email/,
    "the address must come from the verified session"
  );
  assert.match(body, /clearAddressSuppression\(/);

  // Session FIRST and ABOVE the try, so a sessionless call THROWS rather than
  // being converted into a handled `{ success: false }` by the catch.
  const mintAt = body.indexOf("await requireSeat(");
  const tryAt = body.indexOf("try {");
  const clearAt = body.indexOf("clearAddressSuppression(");

  assert.ok(mintAt >= 0 && tryAt >= 0 && clearAt >= 0);
  assert.ok(mintAt < tryAt, "the mint must sit above the try");
  assert.ok(mintAt < clearAt, "nothing is cleared before the actor exists");
});

test("the clear names the self-service path the CHECK constraint was built for", () => {
  const body = clearActionBody();

  // `email_suppressions_cleared_check` requires a reason. Null is the actor
  // column's self-service value — the address holder re-verified, and there is
  // no admin to name — and `cleared_at` is what says the row was cleared.
  assert.match(body, /reason: SUPPRESSION_SELF_CLEAR_REASON/);
  assert.match(body, /clearedByUserId: null/);
  assert.equal(
    SUPPRESSION_SELF_CLEAR_REASON,
    "holder re-verified from settings",
    "the stored reason is what a later dispute reads"
  );
});

test("the settings screen renders the notice only for a suppressed address", () => {
  // A signed-in user with no suppression sees nothing: the read answers false
  // and the notice is behind that answer, not behind a role or a feature flag.
  assert.match(
    PAGE_SOURCE,
    /const emailSuppressed = await isAddressSuppressed\(session\.user\.email\)/,
    "the page asks about the session's own address"
  );
  assert.match(
    PAGE_SOURCE,
    /\{emailSuppressed && \(?\s*<EmailSuppressionNotice/,
    "the notice must be conditional on the suppression"
  );
});

test("the control is a real control — it calls the action", () => {
  assert.match(NOTICE_SOURCE, /clearMyEmailSuppressionAction\(\)/);
  // The cursor scan that used to sit here is gone (#502): the control is a
  // `<Button>`, so it renders a native `<button>` and `globals.css` gives it
  // the pointer — asserted once, in `src/components/ui/cursor-pointer.test.ts`.
  // The notice takes the address as a PROP from the server and holds no server
  // data of its own (memory/contracts/data-patterns.md).
  assert.doesNotMatch(NOTICE_SOURCE, /useState|useEffect/);
});

test("the timezone action takes an IANA id and mints the church from the session", () => {
  assert.match(
    ACTIONS_CODE,
    /export async function setChurchTimeZoneAction\(\s*timeZone: string\s*\)/
  );
  assert.match(ACTIONS_CODE, /refine\(isValidTimeZone\)/);
  // The Owner-only spelling this line used to assert is gone: the timezone is
  // the CHURCH PROFILE (AS-004), which a plant Admin may edit, and the rule is
  // now the capability the guard is called with rather than a predicate
  // repeated in the body.
  assert.match(ACTIONS_CODE, /requireSeat\("church\.profile"\)/);
  assert.match(
    ACTIONS_CODE,
    /setChurchTimeZone\(\s*session\.user\.churchId,\s*parsed\.data\s*\)/
  );
  assert.doesNotMatch(ACTIONS_CODE, /setChurchTimeZoneAction\([^)]*churchId/);
});

const TIMEZONE_SELECT_SOURCE = readFileSync(
  path.join(
    process.cwd(),
    "src/components/settings/church-time-zone-select.tsx"
  ),
  "utf8"
);

test("the timezone control is optimistic, calls the action, and is clickable", () => {
  assert.match(TIMEZONE_SELECT_SOURCE, /setChurchTimeZoneAction\(/);
  assert.match(TIMEZONE_SELECT_SOURCE, /useOptimistic/);
  assert.doesNotMatch(TIMEZONE_SELECT_SOURCE, /useState|useEffect/);
  assert.match(
    TIMEZONE_SELECT_SOURCE,
    /htmlFor="church-time-zone"[^>]*className="cursor-pointer"/
  );
  assert.match(TIMEZONE_SELECT_SOURCE, /data-testid="church-time-zone-select"/);
  // The trigger is pinned for its WIDTH only. Its cursor, and every
  // `SelectItem`'s, come from `src/components/ui/select.tsx` — the one place a
  // `shadcn add` could drop them, and where the guard now sits (#502).
  // The LABEL above is a different case: no selector reaches a `<label>`.
  assert.match(TIMEZONE_SELECT_SOURCE, /className="w-full max-w-md/);
});
