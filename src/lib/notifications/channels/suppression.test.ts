import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { addressSuppressionForEvent } from "./delivery-events";
import { normalizeEmailAddress } from "./suppression";

// ----------------------------------------------------------------------------
// #324 (from #262) — address-level bounce suppression.
//
// The rule in one line: a PERMANENTLY bounced address stops being mailed, and a
// TRANSIENTLY bounced one does not. Getting that backwards is expensive in both
// directions — suppressing a soft bounce silently un-reaches a live cohort
// member, and not suppressing a hard one spends a sending domain's reputation
// one message at a time — and neither failure raises anything.
//
// Real exposure at merge time is ZERO, because nothing calls
// `enqueueNotification` in production yet. That is the reason this lands BEFORE
// the first production enqueuer (U135, the planter digest) rather than after:
// between #251 and that feature, no alarm fires at all.
//
// The policy half is pure and asserted directly. The store half is asserted
// through the SQL its builders emit and the source of its statements — the same
// technique the tenancy guards use, because "this query still names the partial
// index" is not visible in a return value.
// ----------------------------------------------------------------------------

// ============================================================================
// The policy: what suppresses, and what must not
// ============================================================================

test("a hard bounce suppresses the address", () => {
  const decision = addressSuppressionForEvent({
    type: "email.bounced",
    bounceType: "Permanent",
  });

  assert.deepEqual(decision, { suppress: true, reason: "hard_bounce" });
});

test("a bounce with no stated type is treated as hard", () => {
  // The conservative direction for THIS decision. A provider that stops sending
  // `bounce.type` must not silently turn every hard bounce into a retry — and
  // suppression is clearable, so the cost of being wrong is one clear.
  const decision = addressSuppressionForEvent({ type: "email.bounced" });

  assert.deepEqual(decision, { suppress: true, reason: "hard_bounce" });
});

test("a spam complaint suppresses, and says which kind it was", () => {
  // A dead mailbox and an offended reader are both permanent, but they are
  // cleared by different people — a suppression that cannot say which is one an
  // admin cannot rule on.
  const decision = addressSuppressionForEvent({ type: "email.complained" });

  assert.deepEqual(decision, { suppress: true, reason: "spam_complaint" });
});

test("A SOFT BOUNCE DOES NOT SUPPRESS — the address stays sendable", () => {
  // The requirement's own line. A full mailbox empties and a greylisting
  // expires; suppressing on one would silently stop mailing somebody who wanted
  // the mail, and nothing would ever tell us.
  for (const bounceType of [
    "Transient",
    "transient",
    "Soft",
    "SoftBounce",
    "Undetermined",
  ]) {
    assert.deepEqual(
      addressSuppressionForEvent({ type: "email.bounced", bounceType }),
      { suppress: false },
      `${bounceType} keeps its bounded retries`
    );
  }
});

test("a generic delivery failure does not suppress either", () => {
  // `email.failed` means the provider could not hand it off. That is usually
  // about us and never about the mailbox.
  assert.deepEqual(addressSuppressionForEvent({ type: "email.failed" }), {
    suppress: false,
  });
});

test("success and unknown events suppress nothing", () => {
  for (const type of [
    "email.sent",
    "email.delivered",
    "email.opened",
    "email.clicked",
    "email.delivery_delayed",
    "domain.created",
    "contact.updated",
  ]) {
    assert.deepEqual(
      addressSuppressionForEvent({ type }),
      { suppress: false },
      `${type} is not a reason to stop mailing an address`
    );
  }
});

// ============================================================================
// Normalisation — the one stored form
// ============================================================================

test("an address is stored lowercased and trimmed, and nothing else", () => {
  assert.equal(
    normalizeEmailAddress("  Ada@Example.TEST "),
    "ada@example.test"
  );
  assert.equal(normalizeEmailAddress("ada@example.test"), "ada@example.test");
});

test("plus-addresses and dots are NOT folded — those are other mailboxes", () => {
  // Over-normalising here would suppress an address nobody bounced. At some
  // providers `ada+news@` and `a.da@` genuinely are different mailboxes.
  assert.equal(
    normalizeEmailAddress("Ada+news@example.test"),
    "ada+news@example.test"
  );
  assert.equal(normalizeEmailAddress("A.Da@example.test"), "a.da@example.test");
});

test("an empty or whitespace address normalises to nothing", () => {
  assert.equal(normalizeEmailAddress("   "), "");
  assert.equal(normalizeEmailAddress(""), "");
});

// ============================================================================
// The store's statements, pinned on the source
// ============================================================================

const STORE = readFileSync(path.join(__dirname, "suppression.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

/** One exported function's body, comments already stripped. */
function bodyOf(name: string): string {
  const from = STORE.indexOf(`export async function ${name}`);
  assert.notEqual(from, -1, `${name} moved — this guard is watching nothing`);

  const next = STORE.indexOf("\nexport ", from + 1);
  return STORE.slice(from, next === -1 ? undefined : next);
}

test("recording a suppression is ONE conflict-safe statement", () => {
  // Webhook retries arrive concurrently by design — the provider redelivers the
  // same bounce — and SELECT-then-INSERT is not a concurrency guard
  // (memory/invariants.md → Transactions).
  const body = bodyOf("recordAddressSuppression");

  assert.match(body, /onConflictDoNothing\(/, "the insert is conflict-safe");
  assert.match(
    body,
    /target:\s*emailSuppressions\.email/,
    "the arbiter is the address"
  );
  assert.match(
    body,
    /where:\s*isNull\(emailSuppressions\.clearedAt\)/,
    "the index predicate names the PARTIAL index — without it Postgres cannot pick it (42P10)"
  );
});

test("the first suppression's reason and time survive a redelivery", () => {
  // DO NOTHING, never DO UPDATE. Overwriting on a repeat would move
  // `suppressed_at` forward on every webhook retry and lose "when did this
  // start?".
  const body = bodyOf("recordAddressSuppression");

  assert.doesNotMatch(
    body,
    /onConflictDoUpdate/,
    "a repeat must not rewrite the original suppression"
  );
});

test("the recorder normalises before it writes", () => {
  const body = bodyOf("recordAddressSuppression");

  assert.match(body, /normalizeEmailAddress\(input\.email\)/);
  assert.match(
    body,
    /if \(!email\) return null;/,
    "an empty address writes nothing rather than a blank suppression"
  );
});

test("clearing is a compare-and-set on `cleared_at is null`, not a delete", () => {
  // The row stays as history, so an address that bounces, clears and bounces
  // again is three rows and a legible story rather than one row overwritten
  // twice.
  const body = bodyOf("clearAddressSuppression");

  assert.match(body, /\.update\(emailSuppressions\)/);
  assert.doesNotMatch(body, /\.delete\(/, "a clear never deletes the history");
  assert.match(
    body,
    /isNull\(emailSuppressions\.clearedAt\)/,
    "only an ACTIVE suppression is cleared"
  );
  assert.match(
    body,
    /clearedReason:\s*input\.reason/,
    "a clear says why — the CHECK constraint requires it"
  );
});

test("clearing reports how many rows it retired rather than throwing", () => {
  // Clearing an address that is not suppressed is not an error: the caller's
  // intent ("this address should be mailable") already holds.
  const body = bodyOf("clearAddressSuppression");

  assert.match(body, /return cleared\.length;/);
  assert.doesNotMatch(body, /throw new/);
});

test("the read is one query for a whole run, and only ACTIVE rows count", () => {
  // Per-recipient reads here would be an N+1 in the hottest loop in F11, inside
  // a function with a hard timeout.
  const body = bodyOf("loadSuppressedAddresses");

  assert.match(body, /inArray\(emailSuppressions\.email/);
  assert.match(
    body,
    /isNull\(emailSuppressions\.clearedAt\)/,
    "a cleared suppression must not keep an address unmailable"
  );
  assert.match(
    body,
    /new Set\(emails\.map\(normalizeEmailAddress\)/,
    "the run's addresses are normalised and de-duplicated before the query"
  );
});

test("an empty address list makes no query at all", () => {
  const body = bodyOf("loadSuppressedAddresses");

  assert.match(body, /if \(normalised\.length === 0\) return \[\];/);
});

// ============================================================================
// The webhook writes it
// ============================================================================

const WEBHOOK = readFileSync(
  path.join(__dirname, "../../../app/api/webhooks/resend/route.ts"),
  "utf8"
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

test("the webhook suppresses on every permanent failure, not only F11 ones", () => {
  // The delivery update above it matches on a provider message id and hits
  // nothing when the id belongs to a communication or an invitation. Gating the
  // suppression on that would leave the address mailable for the other two.
  assert.match(
    WEBHOOK,
    /await applyNotificationDeliveryEvent\(event, emailId\);/
  );
  assert.match(WEBHOOK, /await applyAddressSuppression\(event\);/);

  const suppressionCall = WEBHOOK.indexOf("await applyAddressSuppression(");
  const recipientLookup = WEBHOOK.indexOf("if (!recipient) {");
  assert.ok(
    suppressionCall !== -1 && suppressionCall < recipientLookup,
    "suppression runs before the unknown-id early return"
  );
});

test("the webhook decides with the shared policy, never its own event list", () => {
  assert.match(WEBHOOK, /addressSuppressionForEvent\(\{/);
  assert.doesNotMatch(
    WEBHOOK,
    /reason:\s*"hard_bounce"/,
    "the route must not name a suppression reason itself"
  );
});

test("a suppression write can never turn into a non-200", () => {
  // Resend redelivers the whole event on a non-200. A suppression that failed to
  // write must not make the provider replay a bounce loop.
  const from = WEBHOOK.indexOf("async function applyAddressSuppression");
  const body = WEBHOOK.slice(from);

  assert.match(body, /try \{/);
  assert.match(body, /catch \(err\) \{/);
  assert.doesNotMatch(
    body.slice(0, body.indexOf("\n}\n")),
    /throw /,
    "nothing rethrows out of the suppression loop"
  );
});
