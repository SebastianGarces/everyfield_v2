import assert from "node:assert/strict";
import { test } from "node:test";

import {
  escapeMergeValues,
  isHtmlFragment,
  isRichTextEmpty,
  plainTextToHtml,
  richTextToPlainText,
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
