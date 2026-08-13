import assert from "node:assert/strict";
import { test } from "node:test";

import { richTextToPlainText } from "@/lib/rich-text/format";
import { ALLOWED_TAGS } from "@/lib/rich-text/sanitize";
import {
  normalizeTaskDescription,
  taskDescriptionPreview,
} from "./descriptions";

// ----------------------------------------------------------------------------
// Task descriptions are rich text (T-021), on COM-017's editor and sanitiser.
//
// Two properties are pinned here, and both are properties of the SERVER half —
// the editor's paste-time sanitise is a courtesy, and `createTask`/`updateTask`
// are POSTable endpoints reachable with no session and no toolbar.
//
//   * `normalizeTaskDescription` is the write gate: hostile markup does not
//     survive it, formatting does, and a description written before T-021 is
//     carried across without a migration.
//   * `taskDescriptionPreview` is what the list surfaces get: readable text,
//     never markup.
//
// The sanitiser itself has its own hostile-input suite in
// `src/lib/rich-text/sanitize.test.ts`. What is asserted here is that the task
// write path actually goes through it.
// ----------------------------------------------------------------------------

const ALLOWED = new Set<string>(ALLOWED_TAGS);

/**
 * No element outside the allow-list survived, whatever the input tried.
 *
 * Asserted over the tag NAMES rather than by grepping for `<script`, because
 * the interesting failures are the ones nobody thought to grep for. Text that
 * still reads like an attack (`ipt&gt;alert(1)` out of a split `<scr<script>`)
 * is fine — it is escaped text in a paragraph, and it cannot run.
 */
function assertOnlyAllowedTags(html: string, input: string) {
  for (const match of html.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)) {
    assert.ok(
      ALLOWED.has(match[1].toLowerCase()),
      `<${match[1]}> survived: ${input}`
    );
  }
}

// ============================================================================
// The write gate
// ============================================================================

test("formatting an author applied survives the write path", () => {
  const html = normalizeTaskDescription(
    "<p>Call <strong>Bob</strong> about the <em>venue</em>.</p>" +
      '<p>See <a href="https://example.com/venue">the listing</a>.</p>' +
      "<ul><li>Confirm capacity</li><li>Ask about parking</li></ul>" +
      "<ol><li>First</li><li>Second</li></ol>"
  );

  assert.ok(html);
  assert.match(html, /<strong>Bob<\/strong>/);
  assert.match(html, /<em>venue<\/em>/);
  assert.match(html, /<a href="https:\/\/example\.com\/venue"/);
  assert.match(html, /<ul><li>Confirm capacity<\/li>/);
  assert.match(html, /<ol><li>First<\/li>/);
});

test("a description written before T-021 becomes the same shape, unmigrated", () => {
  // Exactly what the old `<Textarea>` stored: plain text with newlines.
  const html = normalizeTaskDescription(
    "Call Bob about the venue.\nAsk about parking.\n\nThen book it."
  );

  assert.equal(
    html,
    "<p>Call Bob about the venue.<br>Ask about parking.</p><p>Then book it.</p>"
  );
});

test("a plain-text description carrying angle brackets is text, not markup", () => {
  const html = normalizeTaskDescription("Budget < 500 & > 300");

  assert.equal(html, "<p>Budget &lt; 500 &amp; &gt; 300</p>");
});

test("a pre-T-021 description reads back with every word intact", () => {
  // The seeded case: a planter typed this into a textarea before descriptions
  // were rich text, and there is no migration — the door must carry it. It once
  // read back as "Bring the  and the keys", because the markup-vs-prose test
  // matched any `<word …>` and the sanitiser then deleted what it could not
  // place. Bracketed prose is the shape a real description takes, so the loss
  // was neither theoretical nor rare.
  const seeded =
    "Bring the <signed lease> and the keys.\n\n" +
    "Ask <the landlord> whether a<b for the parking bays, then confirm.";

  const html = normalizeTaskDescription(seeded);
  assert.ok(html);

  // Nothing was interpreted: the brackets are escaped text in paragraphs.
  assertOnlyAllowedTags(html, seeded);
  assert.match(html, /&lt;signed lease&gt;/);
  assert.match(html, /&lt;the landlord&gt;/);
  assert.match(html, /a&lt;b for the parking bays/);

  // And it round-trips: what the planter typed is what the page shows, and
  // what the list summarises.
  assert.equal(richTextToPlainText(html), seeded);
  assert.equal(taskDescriptionPreview(seeded), seeded);
  assert.equal(taskDescriptionPreview(html), seeded);

  // Idempotent, so a re-save does not start eating it either.
  assert.equal(normalizeTaskDescription(html), html);
});

test("no script tag survives a write, however it is spelled", () => {
  const hostile = [
    '<script>alert("xss")</script><p>Notes</p>',
    '<p>Notes</p><SCRIPT SRC="//evil.example/x.js"></SCRIPT>',
    "<p>Notes</p><scr<script>ipt>alert(1)</script>",
    "<p>Notes</p><noscript><script>alert(1)</script></noscript>",
  ];

  for (const input of hostile) {
    const html = normalizeTaskDescription(input) ?? "";
    assert.doesNotMatch(html, /<script/i, input);
    assertOnlyAllowedTags(html, input);
  }
});

test("no event handler survives a write, however it is spelled", () => {
  const hostile = [
    "<img src=x onerror=alert(1)>",
    '<p onclick="alert(1)">Notes</p>',
    "<p ONCLICK='alert(1)'>Notes</p>",
    "<p onmouseover=alert(1)>Notes</p>",
    '<a href="https://example.com" onfocus="alert(1)" autofocus>Notes</a>',
    '<body onload="alert(1)"><p>Notes</p></body>',
  ];

  for (const input of hostile) {
    const html = normalizeTaskDescription(input) ?? "";
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, input);
    assertOnlyAllowedTags(html, input);
  }
});

test("no dangerous href survives a write, entity-spelled or not", () => {
  const hostile = [
    '<a href="javascript:alert(1)">Notes</a>',
    '<a href="&#106;avascript:alert(1)">Notes</a>',
    '<a href="java&#x0A;script:alert(1)">Notes</a>',
    '<a href="JaVaScRiPt:alert(1)">Notes</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Notes</a>',
    '<a href="vbscript:msgbox(1)">Notes</a>',
  ];

  for (const input of hostile) {
    const html = normalizeTaskDescription(input) ?? "";
    assert.doesNotMatch(html, /javascript/i, input);
    assert.doesNotMatch(html, /vbscript/i, input);
    assert.doesNotMatch(html, /data:/i, input);
    // The link text is author content and stays; only the href goes.
    assert.match(html, /Notes/, input);
  }
});

test("an http link keeps its href", () => {
  const html = normalizeTaskDescription(
    '<p><a href="https://example.com/a?b=1&amp;c=2">listing</a></p>'
  );

  assert.match(html ?? "", /href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
});

test("an emptied editor stores NULL, not `<p><br></p>`", () => {
  for (const empty of [
    undefined,
    null,
    "",
    "   ",
    "<p><br></p>",
    "<p></p><p><br></p>",
    "<div><br></div>",
  ]) {
    assert.equal(normalizeTaskDescription(empty), null, JSON.stringify(empty));
  }
});

test("the write gate is idempotent — a re-save does not re-escape", () => {
  // A contentEditable serialises `Bob & Sue <3` to entities, and an edit-save
  // cycle sends that back through the gate. Two passes must agree.
  const once = normalizeTaskDescription(
    "<p>Bob &amp; Sue &lt;3&nbsp; today</p>"
  );
  const twice = normalizeTaskDescription(once);

  assert.equal(twice, once);
  assert.match(once ?? "", /Bob &amp; Sue &lt;3/);
});

// ============================================================================
// The list preview
// ============================================================================

test("a preview is readable text, never markup", () => {
  const preview = taskDescriptionPreview(
    "<p>Call <strong>Bob</strong> about the <em>venue</em>.</p>" +
      '<p>See <a href="https://example.com">the listing</a>.</p>'
  );

  assert.ok(preview);
  assert.doesNotMatch(preview, /[<>]/);
  assert.match(preview, /Call Bob about the venue\./);
  assert.match(preview, /See the listing\./);
});

test("a preview of a list reads as a list, not as tags", () => {
  const preview = taskDescriptionPreview(
    "<ul><li>Confirm capacity</li><li>Ask about parking</li></ul>"
  );

  assert.equal(preview, "- Confirm capacity\n- Ask about parking");
});

test("a preview of hostile markup carries no tag and no handler", () => {
  const preview =
    taskDescriptionPreview(
      "<p>Notes</p><script>alert(1)</script><img src=x onerror=alert(1)>"
    ) ?? "";

  assert.doesNotMatch(preview, /[<>]/);
  assert.doesNotMatch(preview, /alert/);
  assert.match(preview, /Notes/);
});

test("a preview of a pre-T-021 plain-text description is the text itself", () => {
  assert.equal(
    taskDescriptionPreview("Call Bob about the venue."),
    "Call Bob about the venue."
  );
});

test("a preview of nothing is null, so a card can ask one question", () => {
  for (const empty of [undefined, null, "", "   ", "<p><br></p>"]) {
    assert.equal(taskDescriptionPreview(empty), null, JSON.stringify(empty));
  }
});

test("a preview is not truncated — the card decides how much fits", () => {
  const long = `<p>${"word ".repeat(200).trim()}</p>`;
  const preview = taskDescriptionPreview(long) ?? "";

  assert.equal(preview.split(" ").length, 200);
});
