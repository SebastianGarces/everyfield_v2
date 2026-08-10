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
// separate `dangerouslySetInnerHTML` — and the CONCATENATION must be balanced
// too, because those blocks end up in one document.
//
// The checker below walks EVERY element, not just `<p>`. Counting paragraphs is
// what let `<ul><li>RSVP __EF_CONFIRM__</li></ul>` ship a list that opened in
// one div and closed in the next.
// ----------------------------------------------------------------------------

const VOID = new Set(["br", "hr", "img", "wbr"]);

/** Every open tag closed, in the order it was opened, or the reason it is not. */
function imbalance(html: string): string | null {
  const stack: string[] = [];
  for (const match of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
    const name = match[2].toLowerCase();
    if (VOID.has(name)) continue;
    if (match[1] === "/") {
      if (stack.length === 0) return `stray </${name}> in: ${html}`;
      const open = stack.pop();
      if (open !== name) return `</${name}> closes <${open}> in: ${html}`;
      continue;
    }
    stack.push(name);
  }
  return stack.length === 0
    ? null
    : `unclosed <${stack.join("><")}> in: ${html}`;
}

function assertBalanced(segments: RichEmailSegment[]) {
  for (const segment of segments) {
    if (segment.type !== "html") continue;
    assert.equal(imbalance(segment.html), null);
  }
  // And the assembled document, which is what the recipient's client parses.
  const assembled = segments
    .filter((segment) => segment.type === "html")
    .map((segment) => segment.html)
    .join("");
  assert.equal(imbalance(assembled), null);
}

test("the balance checker sees an unbalanced list, not just a paragraph", () => {
  // Guards the guard: the old helper counted `<p>` only and called this fine.
  assert.notEqual(imbalance("<ul><li>a"), null);
  assert.notEqual(imbalance("</li></ul>"), null);
  assert.notEqual(imbalance("<p><strong>a</p></strong>"), null);
  assert.equal(imbalance("<ul><li>a<br>b</li></ul>"), null);
});

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

// ----------------------------------------------------------------------------
// Lists. A planter can compose one today — it is a toolbar control — and a
// merge field dropped inside a bullet is the case that used to cut `<ul><li>`
// in half.
// ----------------------------------------------------------------------------

test("a token inside a list item closes the list before the buttons", () => {
  const segments = parseRichEmailBody(
    `<ul><li>RSVP ${CONFIRM}</li><li>b</li></ul>`
  );

  assert.deepEqual(segments, [
    { type: "html", html: "<ul><li>RSVP</li></ul>" },
    { type: "buttons" },
    { type: "html", html: "<ul><li>b</li></ul>" },
  ]);
  assertBalanced(segments);
});

test("a token that owns its list item leaves no empty bullet behind", () => {
  const segments = parseRichEmailBody(
    `<p>a</p><ul><li>${CONFIRM}</li></ul><p>z</p>`
  );

  assert.deepEqual(segments, [
    { type: "html", html: "<p>a</p>" },
    { type: "buttons" },
    { type: "html", html: "<p>z</p>" },
  ]);
  assertBalanced(segments);
});

test("both tokens inside one numbered list still make one button row", () => {
  const segments = parseRichEmailBody(
    `<ol><li>Coming? ${CONFIRM}</li><li>${DECLINE}</li></ol>`
  );

  assertBalanced(segments);
  assert.equal(segments.filter((s) => s.type === "buttons").length, 1);
  const html = segments
    .filter((s) => s.type === "html")
    .map((s) => s.html)
    .join("");
  assert.ok(!html.includes(CONFIRM) && !html.includes(DECLINE), html);
  assert.ok(html.includes("Coming?"), html);
});

test("a token nested inside formatting closes the formatting too", () => {
  const segments = parseRichEmailBody(
    `<p><strong>Please <em>reply</em> ${CONFIRM} today</strong></p>`
  );

  assertBalanced(segments);
  assert.deepEqual(segments, [
    { type: "html", html: "<p><strong>Please <em>reply</em></strong></p>" },
    { type: "buttons" },
    { type: "html", html: "<p><strong>today</strong></p>" },
  ]);
});

test("a token inside a link keeps the link's href on both sides of the cut", () => {
  const segments = parseRichEmailBody(
    `<p><a href="https://e.example" target="_blank" rel="noopener noreferrer">tap ${CONFIRM} here</a></p>`
  );

  assertBalanced(segments);
  const html = segments
    .filter((s) => s.type === "html")
    .map((s) => s.html)
    .join("");
  assert.equal(
    (html.match(/href="https:\/\/e\.example"/g) ?? []).length,
    2,
    html
  );
});

test("a token between two lists cuts at the boundary, keeping both", () => {
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

test("a composed body with the token in every position stays balanced", () => {
  const bodies = [
    `${CONFIRM}`,
    `<p>${CONFIRM}</p>`,
    `<ul><li>${CONFIRM}</li></ul>`,
    `<ul><li>a ${CONFIRM} b</li><li>c</li></ul>`,
    `<ol><li><strong>${CONFIRM}</strong></li></ol>`,
    `<p>a</p><ul><li>b ${CONFIRM}</li></ul><p>c ${DECLINE}</p>`,
    `<ul><li>a<br>${CONFIRM}<br>b</li></ul>`,
    `<p>before</p>${CONFIRM}<ul><li>after</li></ul>`,
  ];

  for (const body of bodies) {
    const segments = parseRichEmailBody(body);
    assertBalanced(segments);
    for (const segment of segments) {
      if (segment.type !== "html") continue;
      assert.ok(!segment.html.includes(CONFIRM), segment.html);
      assert.ok(!segment.html.includes(DECLINE), segment.html);
    }
  }
});

test("an empty body produces no segments", () => {
  assert.deepEqual(parseRichEmailBody(""), []);
});
