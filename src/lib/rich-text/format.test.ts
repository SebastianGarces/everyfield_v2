import assert from "node:assert/strict";
import { test } from "node:test";

import {
  escapeMergeValues,
  highlightUnresolvedMergeTokens,
  isHtmlFragment,
  isRichTextEmpty,
  plainTextToHtml,
  richTextToPlainText,
  sanitizeEditorHtml,
  toRichTextHtml,
} from "./format";

// ----------------------------------------------------------------------------
// There is no migration behind COM-017: every stored template body and every
// message already sent is plain text with newlines. `toRichTextHtml` is the one
// door that decides which of the two it is looking at, so these tests pin that
// decision, in both directions, including the shapes the seeded templates use.
// ----------------------------------------------------------------------------

test("isHtmlFragment tells markup from prose", () => {
  assert.equal(isHtmlFragment("<p>hi</p>"), true);
  assert.equal(isHtmlFragment("hi<br>there"), true);
  assert.equal(isHtmlFragment("Hi Sarah,\n\nSee you at 7."), false);
  // Prose that merely contains angle brackets is still prose.
  assert.equal(isHtmlFragment("2 < 3 and 5 > 4"), false);
  assert.equal(isHtmlFragment("Reply to <3 people"), false);
});

test("prose that LOOKS like a tag is still prose", () => {
  // The regression this replaced: any `<word …>` counted, so ordinary prose was
  // routed to the sanitiser, which unwrapped what it did not recognise and
  // DELETED the words inside. Silent loss of pre-existing user text, on every
  // read surface.
  //
  // The rule now: a real HTML element name, AND a finished tag — void, or
  // closed later in the string.
  assert.equal(isHtmlFragment("Bring the <signed lease> and the keys"), false);
  assert.equal(isHtmlFragment("Call <see notes> before Friday"), false);
  // `b` IS an element, but nothing closes it, so this is arithmetic.
  assert.equal(isHtmlFragment("if a<b and c>d then stop"), false);
  // A lone closing tag proves nothing — an opener with a match proves it first.
  assert.equal(isHtmlFragment("scored 3</4 overall"), false);
  // …and the real thing still reads as markup.
  assert.equal(isHtmlFragment("a <b>bold</b> claim"), true);
  assert.equal(isHtmlFragment("<ul><li>one</li></ul>"), true);
  assert.equal(isHtmlFragment("line<br/>break"), true);
});

test("legacy prose that looks like a tag survives the door word for word", () => {
  const cases: Array<[string, string]> = [
    [
      "Bring the <signed lease> and the keys",
      "<p>Bring the &lt;signed lease&gt; and the keys</p>",
    ],
    [
      "Call <see notes> before Friday",
      "<p>Call &lt;see notes&gt; before Friday</p>",
    ],
    ["if a<b and c>d then stop", "<p>if a&lt;b and c&gt;d then stop</p>"],
  ];

  for (const [authored, expected] of cases) {
    assert.equal(toRichTextHtml(authored), expected, authored);
    // And it reads back as exactly what was typed.
    assert.equal(richTextToPlainText(toRichTextHtml(authored)), authored);
  }
});

test("plain text becomes one paragraph per blank-line block", () => {
  assert.equal(
    plainTextToHtml("Hi Sarah,\n\nSee you\nat seven."),
    "<p>Hi Sarah,</p><p>See you<br>at seven.</p>"
  );
});

test("plain text is escaped on the way in", () => {
  assert.equal(
    plainTextToHtml("<script>alert(1)</script>"),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"
  );
});

test("a legacy template body converts without losing its merge fields", () => {
  const legacy = `Hi {{first_name}},

You're invited to {{meeting_title}}.

{{confirm_link}}
{{decline_link}}

— {{church_name}}`;

  const html = toRichTextHtml(legacy);
  for (const token of [
    "{{first_name}}",
    "{{meeting_title}}",
    "{{confirm_link}}",
    "{{decline_link}}",
    "{{church_name}}",
  ]) {
    assert.ok(html.includes(token), `${token} lost: ${html}`);
  }
  // The two RSVP tokens sat on adjacent lines; they must stay adjacent so the
  // email's button pass still recognises the block.
  assert.ok(html.includes("{{confirm_link}}<br>{{decline_link}}"), html);
});

test("toRichTextHtml sanitises markup and converts prose", () => {
  assert.equal(toRichTextHtml("<p onclick='x'>hi</p>"), "<p>hi</p>");
  assert.equal(toRichTextHtml("hi"), "<p>hi</p>");
  assert.equal(toRichTextHtml(""), "");
  assert.equal(toRichTextHtml(null), "");
  assert.equal(toRichTextHtml(undefined), "");
});

test("toRichTextHtml is idempotent", () => {
  const once = toRichTextHtml("Hi {{first_name}},\n\nWelcome.");
  assert.equal(toRichTextHtml(once), once);
});

test("rich text flattens back to readable plain text", () => {
  assert.equal(
    richTextToPlainText(
      "<p>Hi <strong>Sarah</strong>,</p><p>See you<br>at seven.</p>"
    ),
    "Hi Sarah,\n\nSee you\nat seven."
  );
});

test("a list flattens to one line per item", () => {
  assert.equal(
    richTextToPlainText(
      "<ul><li>bring a chair</li><li>bring a friend</li></ul>"
    ),
    "- bring a chair\n- bring a friend"
  );
});

test("a block that OPENS after text still starts a new line", () => {
  // The shape the toolbar produces every time an author types a line and then
  // clicks the bullet button: no closing block tag stands between the prose and
  // the list, so breaking only at closing tags glued them into "keys- Checklist"
  // in the text/plain half, the searchable `body` column and the task card.
  assert.equal(richTextToPlainText("a<ul><li>b</li></ul>"), "a\n\n- b");
  assert.equal(
    richTextToPlainText(
      "Bring the <strong>signed lease</strong> and <em>keys</em>" +
        "<ul><li>Checklist</li></ul>"
    ),
    "Bring the signed lease and keys\n\n- Checklist"
  );
});

test("entities are decoded on the way out, so the email reads as typed", () => {
  assert.equal(richTextToPlainText("<p>Tom &amp; Jo &lt;3</p>"), "Tom & Jo <3");
});

test("an emptied editor counts as empty, however it spells it", () => {
  for (const empty of ["", "<p></p>", "<p><br></p>", "<p>&nbsp;</p>", null]) {
    assert.equal(isRichTextEmpty(empty), true, JSON.stringify(empty));
  }
  assert.equal(isRichTextEmpty("<p>hi</p>"), false);
});

test("escapeMergeValues escapes values and leaves RSVP placeholders alone", () => {
  const escaped = escapeMergeValues({
    first_name: `Bobby <script>alert("x")</script>`,
    confirm_link: "__EF_CONFIRM__",
  });

  assert.ok(!escaped.first_name.includes("<script"));
  assert.equal(
    escaped.first_name,
    "Bobby &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
  );
  // The placeholder carries no escapable character, so the button pass
  // downstream still finds it.
  assert.equal(escaped.confirm_link, "__EF_CONFIRM__");
});

// ----------------------------------------------------------------------------
// `toRichTextHtml` is called more than once on the way to a recipient — the
// editor on paste, `sendCommunication` before storing, the renderer on the way
// out. Its doc comment claims it is safe to call twice; these tests are what
// makes that claim true. The fixture is an innerHTML string, because that is
// what a contentEditable actually produces: `&`, `<` and `>` already encoded,
// and `&nbsp;` inserted on its own for a repeated or trailing space.
// ----------------------------------------------------------------------------

/** What a contentEditable serialises for: Bob & Sue <3  today */
const BROWSER_SERIALISED = `<p>Bob &amp; Sue &lt;3&nbsp; today</p>`;

test("toRichTextHtml is idempotent over an innerHTML round trip", () => {
  const once = toRichTextHtml(BROWSER_SERIALISED);
  assert.equal(toRichTextHtml(once), once, once);
  assert.equal(toRichTextHtml(toRichTextHtml(once)), once, once);
});

test("an unformatted body round trips too — the editor emits a block", () => {
  // The fixtures above all keep a `<p>`, and that is why this one got through:
  // a contentEditable an author has only TYPED into holds a bare text node, so
  // the innerHTML is escaped text with no tag in it at all. Emitted as-is it
  // reads as legacy plain text on the next pass, its escapes get escaped —
  // `Q &amp;amp; A` — and the planter reads `Q &amp; A` in their own inbox.
  const typedInnerHtml = "Q &amp; A tonight &lt;3";
  const emitted = sanitizeEditorHtml(typedInnerHtml);

  assert.equal(emitted, "<p>Q &amp; A tonight &lt;3</p>");
  assert.equal(toRichTextHtml(emitted), emitted, emitted);
  assert.equal(richTextToPlainText(emitted), "Q & A tonight <3");
});

test("what the editor emits for markup is what the door would store", () => {
  // One value, whichever way it is reached: the editor's emission and the
  // door's answer may not be two different strings, or a body would change the
  // first time it was saved without being edited.
  for (const innerHtml of [
    "<p>Hi <strong>Sarah</strong></p>",
    "<div><ul><li>one</li></ul></div>",
    "Q &amp; A tonight",
    "",
  ]) {
    const emitted = sanitizeEditorHtml(innerHtml);
    assert.equal(toRichTextHtml(emitted), emitted, innerHtml);
  }
});

test("a body sanitised down to bare words still comes back as a block", () => {
  // A rejected link is unwrapped to its text, which can leave the whole body
  // tag-free. Same trap, reached from the hostile side rather than the typing
  // side.
  const once = toRichTextHtml(`<a href="javascript:alert(1)">Bob & Sue</a>`);

  assert.equal(once, "<p>Bob &amp; Sue</p>");
  assert.equal(toRichTextHtml(once), once, once);
  assert.equal(richTextToPlainText(once), "Bob & Sue");
});

test("the rendered text is the text that was typed, after any pass count", () => {
  let html = BROWSER_SERIALISED;
  for (let pass = 0; pass < 4; pass += 1) {
    html = toRichTextHtml(html);
    assert.equal(
      richTextToPlainText(html),
      "Bob & Sue <3  today",
      `pass ${pass + 1}`
    );
  }
});

test("a legacy plain-text body converts once and then holds still", () => {
  const once = toRichTextHtml("Bob & Sue <3\n\nSee you Sunday.");
  assert.equal(toRichTextHtml(once), once, once);
  assert.equal(richTextToPlainText(once), "Bob & Sue <3\n\nSee you Sunday.");
});

// ----------------------------------------------------------------------------
// The COM-015 preview's red pill is drawn over MARKUP, so it has to know where
// the text nodes are. A blind string replace wrote the span into `href` values
// — `sanitizeUrl` allows a token in a path whose scheme is already fixed — and
// a browser then closed the attribute at the span's own quote: a broken link,
// and no warning on the one token the pill exists to catch.
// ----------------------------------------------------------------------------

test("an unresolved token in TEXT is highlighted", () => {
  const html = highlightUnresolvedMergeTokens(
    "<p>Hi <strong>{{nope}}</strong></p>"
  );

  assert.ok(html.includes("#dc2626"), html);
  assert.ok(html.includes(">{{nope}}</span>"), html);
  // The formatting around it is untouched.
  assert.ok(html.startsWith("<p>Hi <strong><span "), html);
  assert.ok(html.endsWith("</span></strong></p>"), html);
});

test("an unresolved token inside an ATTRIBUTE is left exactly as it is", () => {
  const href = `<p><a href="https://everyfield.app/x/{{ticket_id}}" target="_blank" rel="noopener noreferrer">ticket</a></p>`;

  assert.equal(highlightUnresolvedMergeTokens(href), href);
});

test("a token in an href and a token in text are decided separately", () => {
  const html = highlightUnresolvedMergeTokens(
    `<p><a href="https://everyfield.app/x/{{ticket_id}}">{{ticket_id}}</a></p>`
  );

  // One pill, and it is the one between the tags.
  assert.equal((html.match(/#dc2626/g) ?? []).length, 1, html);
  assert.ok(
    html.includes(`href="https://everyfield.app/x/{{ticket_id}}"`),
    html
  );
  assert.ok(html.includes(`>{{ticket_id}}</span>`), html);
});

test("a subject, which arrives escaped and tagless, still highlights", () => {
  const html = highlightUnresolvedMergeTokens("Reminder for {{nope}} &lt;3");

  assert.ok(html.includes("#dc2626"), html);
  assert.ok(html.includes("&lt;3"), html);
});

test("a body with no leftover token comes back unchanged", () => {
  const html = `<p>Hi <strong>Sarah</strong>, see you Sunday.</p>`;

  assert.equal(highlightUnresolvedMergeTokens(html), html);
});
