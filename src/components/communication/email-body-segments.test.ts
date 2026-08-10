import assert from "node:assert/strict";
import { test } from "node:test";

import { toRichTextHtml } from "@/lib/rich-text/format";
import { renderTemplate } from "@/lib/communication/merge";

import {
  parseRichEmailBody,
  type RichEmailSegment,
} from "./email-body-segments";

const CONFIRM = "__EF_CONFIRM__";
const DECLINE = "__EF_DECLINE__";

// ----------------------------------------------------------------------------
// The failure this file exists to prevent: an email whose HTML is cut mid-tag,
// which renders as a wall of raw markup in half the mail clients out there.
// Every `html` segment must be balanced on its own, because each is handed to a
// separate `dangerouslySetInnerHTML`.
// ----------------------------------------------------------------------------

function assertBalanced(segments: RichEmailSegment[]) {
  for (const segment of segments) {
    if (segment.type !== "html") continue;
    const opens = (segment.html.match(/<p>/g) ?? []).length;
    const closes = (segment.html.match(/<\/p>/g) ?? []).length;
    assert.equal(opens, closes, `unbalanced paragraph: ${segment.html}`);
  }
}

test("a body with no RSVP tokens is one html segment", () => {
  const segments = parseRichEmailBody("<p>Hello <strong>there</strong></p>");
  assert.deepEqual(segments, [
    { type: "html", html: "<p>Hello <strong>there</strong></p>" },
  ]);
});

test("adjacent RSVP tokens become ONE button row", () => {
  const html = `<p>Please let us know:</p><p>${CONFIRM}<br>${DECLINE}</p><p>See you!</p>`;
  const segments = parseRichEmailBody(html);

  assert.deepEqual(segments, [
    { type: "html", html: "<p>Please let us know:</p>" },
    { type: "buttons" },
    { type: "html", html: "<p>See you!</p>" },
  ]);
  assertBalanced(segments);
});

test("tokens in separate paragraphs still collapse to one row when adjacent", () => {
  const html = `<p>${CONFIRM}</p><p>${DECLINE}</p>`;
  assert.deepEqual(parseRichEmailBody(html), [{ type: "buttons" }]);
});

test("text sharing the paragraph with a token survives, balanced", () => {
  const html = `<p>RSVP here: ${CONFIRM}</p>`;
  const segments = parseRichEmailBody(html);

  assert.deepEqual(segments, [
    { type: "html", html: "<p>RSVP here:</p>" },
    { type: "buttons" },
  ]);
  assertBalanced(segments);
});

test("a token outside any paragraph does not cut a tag in half", () => {
  const segments = parseRichEmailBody(
    `<ul><li>one</li></ul>${CONFIRM}<p>after</p>`
  );

  assertBalanced(segments);
  assert.equal(segments.filter((s) => s.type === "buttons").length, 1);
  assert.ok(segments.some((s) => s.type === "html" && s.html.includes("<li>")));
});

test("the seeded invitation template survives the whole pipeline", () => {
  // Exactly what a planter sends today: a plain-text system template, converted
  // to rich text, merge-rendered, then cut for the email.
  const legacyTemplate = `Hi {{first_name}},

You're invited to {{meeting_title}}.

{{confirm_link}}
{{decline_link}}

Looking forward to it!`;

  const rendered = renderTemplate(toRichTextHtml(legacyTemplate), {
    first_name: "Sarah",
    meeting_title: "Vision Meeting",
    confirm_link: CONFIRM,
    decline_link: DECLINE,
  });

  const segments = parseRichEmailBody(rendered);
  assertBalanced(segments);

  assert.equal(segments.filter((s) => s.type === "buttons").length, 1);
  const html = segments
    .filter((s) => s.type === "html")
    .map((s) => s.html)
    .join("");
  assert.ok(html.includes("Hi Sarah,"), html);
  assert.ok(html.includes("Vision Meeting"), html);
  assert.ok(!html.includes(CONFIRM), html);
  assert.ok(!html.includes(DECLINE), html);
});

test("an empty body produces no segments", () => {
  assert.deepEqual(parseRichEmailBody(""), []);
});
