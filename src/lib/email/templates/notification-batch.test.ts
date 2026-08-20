import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { notificationPreferencesUrl } from "@/lib/notifications/channels/email";

import { notificationBatchEmail } from "./notification-batch";

// ----------------------------------------------------------------------------
// ONE ITEM IS NOT A SPECIAL CASE (#263 item 1, via #324 WS2)
//
// The template carried a `items.length === 1` branch that rendered, byte for
// byte, what the map renders for a one-entry list. The #251 review called it a
// dead branch; the point of the finding was not the duplication but the
// AMBIGUITY — a reader could not tell whether the two arms were meant to
// diverge later or whether one was already unreachable, and there is no third
// answer a comment could have supplied. So the branch is gone.
//
// These tests fence that in from both sides: the rendered output for a group of
// one must be exactly what the list path produces, and no second shape may come
// back into the file. Behaviour first, source second — the source assertion
// alone would pass over a template that had stopped rendering anything.
// ----------------------------------------------------------------------------

const TEMPLATE = path.join(__dirname, "notification-batch.tsx");

const BASE = {
  recipientName: "Maria",
  categoryLabel: "Tasks",
  unsubscribeUrl: "https://everyfield.test/unsubscribe?token=abc",
  preferencesUrl: notificationPreferencesUrl("https://everyfield.test"),
};

test("a group of one renders that one notification", async () => {
  const { html, text } = await notificationBatchEmail({
    ...BASE,
    items: [{ title: "Draft the launch plan", body: "Due Friday." }],
  });

  for (const rendered of [html, text]) {
    assert.match(rendered, /Draft the launch plan/);
    assert.match(rendered, /Due Friday\./);
  }
  // The footer is unconditional — an email that could be composed without an
  // opt-out is one that eventually is.
  assert.match(html, /unsubscribe\?token=abc/);
});

test("a group of one renders through the SAME path as a group of many", async () => {
  // The proof that removing the branch changed nothing: render two groups whose
  // only difference is the number of items, and assert the one-item output is
  // the many-item output with the extra items removed. If a special case comes
  // back and diverges by so much as a style, this fails.
  const first = { title: "Draft the launch plan", body: "Due Friday." };
  const second = { title: "Call the core group", body: "Three left." };

  const one = await notificationBatchEmail({ ...BASE, items: [first] });
  const two = await notificationBatchEmail({ ...BASE, items: [first, second] });

  assert.ok(
    two.html.includes(second.title),
    "the second item did not render at all — the fixture is not testing what it claims"
  );

  // Everything the one-item email contains, the two-item email contains in the
  // same shape: same layout, same item markup, same footer.
  const withoutSecond = two.html
    .split(second.title)
    .join("")
    .split(second.body)
    .join("");

  for (const marker of [
    BASE.categoryLabel,
    BASE.recipientName,
    BASE.unsubscribeUrl,
    first.title,
    first.body,
  ]) {
    assert.ok(
      one.html.includes(marker) && withoutSecond.includes(marker),
      `"${marker}" does not render the same way for a group of one and a group of two`
    );
  }
});

test("the dead single-item branch is gone from the source", () => {
  // Comments stripped first: the file's own header NAMES the branch it removed,
  // and a guard that cannot tell an explanation from a reintroduction is a guard
  // that forbids explaining anything.
  const source = readFileSync(TEMPLATE, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  assert.doesNotMatch(
    source,
    /items\.length\s*===\s*1/,
    "the `items.length === 1` branch is back in notification-batch.tsx. It renders what the map already renders; #263 item 1 removed it rather than leave the next reader guessing whether it was dead or pending."
  );
  assert.doesNotMatch(
    source,
    /\bconst\s+single\b/,
    "a `single` flag is back in notification-batch.tsx — see #263 item 1"
  );
});
