import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@react-email/components";

import { MessageBody } from "@/components/communication/message-body";
import { CommunicationEmail } from "@/lib/email/components/communication-email";
import {
  normalizeTaskDescription,
  taskDescriptionPreview,
} from "@/lib/tasks/service";

import {
  richTextToPlainText,
  sanitizeEditorHtml,
  toRichTextHtml,
} from "./format";
import { ALLOWED_TAGS } from "./sanitize";

// ----------------------------------------------------------------------------
// One editor, two consumers (COM-017 + T-021).
//
// The suites either side of this one each prove their own half: the send path
// delivers formatted email (`communication-email.test.ts`), the task path
// stores and previews formatted descriptions (`descriptions.test.ts`). Neither
// can see the failure this file exists for — the two halves DRIFTING. They were
// built as one editor and one sanitiser deliberately, and the thing that makes
// that claim true is not that both files import `format.ts`; it is that the
// same body, put in either door, comes out the same on the other side.
//
// So every test here runs ONE input through BOTH paths and compares them. A
// change that hardens the message door and forgets the task door (or the
// reverse) is a passing suite everywhere else and a failing one here.
//
// The doors:
//   * messages — `toRichTextHtml(input.body)` in `sendCommunication`, whose I/O
//     is stripped here exactly as the email suite strips it.
//   * tasks — `normalizeTaskDescription`, called by `createTask`/`updateTask`.
// ----------------------------------------------------------------------------

const ALLOWED = new Set<string>(ALLOWED_TAGS);

/**
 * The stored markup each door produces for the same authored body.
 *
 * The task door answers NULL for a body with nothing in it — that is the
 * column's own spelling of "no description", and the one difference between the
 * two doors that is deliberate. It is flattened here so every other difference
 * is a failure.
 */
function throughBothDoors(authored: string) {
  return {
    message: toRichTextHtml(authored),
    task: normalizeTaskDescription(authored) ?? "",
  };
}

/** No element outside the allow-list survived, whichever door it came through. */
function assertOnlyAllowedTags(html: string, context: string) {
  for (const match of html.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)) {
    assert.ok(
      ALLOWED.has(match[1].toLowerCase()),
      `<${match[1]}> survived ${context}`
    );
  }
}

/** What a planter actually composes: every control the toolbar offers. */
const FORMATTED_BODY =
  `<p>Hi <strong>Sarah</strong>, this is <em>important</em>.</p>` +
  `<p>Details: <a href="https://everyfield.app/rsvp">RSVP here</a>.</p>` +
  `<ul><li>Bring a <strong>Bible</strong></li><li>Arrive by 9</li></ul>` +
  `<ol><li>Sign in</li></ol>`;

/** Bodies whose handling must not differ between the two features. */
const SHARED_BODIES: Array<{ name: string; authored: string }> = [
  { name: "every formatting control", authored: FORMATTED_BODY },
  {
    name: "a body written before either feature shipped",
    authored: "Call Bob about the venue.\n\nHe prefers the morning.",
  },
  {
    name: "what a contentEditable serialises",
    authored: "<p>Bob &amp; Sue &lt;3&nbsp; today</p>",
  },
  {
    name: "a list a contentEditable wrapped in a div",
    authored: "<div><ul><li>one</li><li>two</li></ul></div>",
  },
];

/** Pastes that must be disarmed identically on both sides. */
const HOSTILE_BODIES: Array<{ name: string; authored: string }> = [
  {
    name: "a script tag",
    authored: `<p>Hello</p><script>fetch("https://evil.example")</script>`,
  },
  {
    name: "an inline event handler",
    authored: `<p onclick="fetch('https://evil.example')">Hello</p>`,
  },
  {
    name: "an image with onerror",
    authored: `<img src=x onerror="fetch('https://evil.example')">`,
  },
  {
    name: "a javascript: href",
    authored: `<a href="javascript:alert(1)">click</a>`,
  },
  {
    name: "an entity-spelled javascript: href",
    authored: `<a href="&#106;avascript:alert(1)">click</a>`,
  },
  {
    name: "a style block",
    authored: `<style>body{background:url("https://evil.example")}</style><p>Hello</p>`,
  },
];

// ============================================================================
// The two write doors
// ============================================================================

for (const { name, authored } of SHARED_BODIES) {
  test(`both doors store the same markup — ${name}`, () => {
    const { message, task } = throughBothDoors(authored);
    assert.equal(
      task,
      message,
      `the task door and the message door disagree about: ${authored}`
    );
  });
}

for (const { name, authored } of HOSTILE_BODIES) {
  test(`both doors disarm the same paste the same way — ${name}`, () => {
    const { message, task } = throughBothDoors(authored);

    // Equal FIRST: a difference here means one feature was hardened alone, and
    // whichever door is the weaker one is a live injection surface.
    assert.equal(task, message, `doors disagree about: ${authored}`);

    for (const [door, stored] of [
      ["the message door", message],
      ["the task door", task],
    ] as const) {
      assertOnlyAllowedTags(stored, `${door}: ${authored}`);
      assert.ok(
        !/\son[a-z]+\s*=/i.test(stored),
        `an event handler survived ${door}: ${stored}`
      );
      assert.ok(
        !stored.toLowerCase().includes("javascript:"),
        `a javascript: URL survived ${door}: ${stored}`
      );
      assert.ok(
        !stored.includes("evil.example"),
        `hostile content survived ${door}: ${stored}`
      );
    }
  });
}

test("what one door stored, the other accepts unchanged", () => {
  // The same body is edited on both surfaces over its life — a template body
  // becomes a task description, a description is pasted into a message. Neither
  // door may "improve" what the other wrote, or a save with no edit would
  // rewrite the row.
  for (const { authored } of [...SHARED_BODIES, ...HOSTILE_BODIES]) {
    const { message, task } = throughBothDoors(authored);

    assert.equal(normalizeTaskDescription(message) ?? "", task, authored);
    assert.equal(toRichTextHtml(task), message, authored);
  }
});

test("an unformatted body is not escaped a second time on either side", () => {
  // The one that got past both suites: an author who types without pressing a
  // toolbar button leaves a bare text node behind, so the editor's innerHTML is
  // escaped text with no tag in it. Emitted as-is it reads as "legacy plain
  // text" at the next door, its escapes get escaped, and a planter who typed
  // `Q & A` reads `Q &amp; A` in their own inbox — and on their own task.
  // `sanitizeEditorHtml` is the editor's emission, so this is the real path.
  const typedInnerHtml = "Q &amp; A tonight &lt;3";
  const emitted = sanitizeEditorHtml(typedInnerHtml);

  for (const [door, stored] of [
    ["the message door", toRichTextHtml(emitted)],
    ["the task door", normalizeTaskDescription(emitted) ?? ""],
  ] as const) {
    assert.ok(!stored.includes("&amp;amp;"), `${door}: ${stored}`);
    assert.ok(!stored.includes("&amp;lt;"), `${door}: ${stored}`);
    assert.equal(richTextToPlainText(stored), "Q & A tonight <3", door);
  }
});

test("an emptied editor is empty on both sides, however it spells it", () => {
  // The task door answers NULL (the column's own "no description"); the message
  // door answers with markup and `isRichTextEmpty` decides. What must agree is
  // that neither treats `<p><br></p>` as content — the compose guard and the
  // task write gate both refuse it, so neither a blank email nor a blank
  // description card can be produced by pressing backspace.
  for (const empty of ["<p><br></p>", "<p></p>", "   ", "<div><br></div>"]) {
    assert.equal(normalizeTaskDescription(empty), null, JSON.stringify(empty));
    assert.equal(
      richTextToPlainText(toRichTextHtml(empty)),
      "",
      JSON.stringify(empty)
    );
  }
});

// ============================================================================
// The read surfaces
// ============================================================================

test("the message surface and the task surface show the same markup", async () => {
  const stored = toRichTextHtml(FORMATTED_BODY);

  // The task detail page renders `toRichTextHtml(task.description)` into a div;
  // `MessageBody` sanitises the stored body and renders that. Same body, same
  // markup on screen — a planter reading their own message and their own task
  // sees one product, not two.
  const onMessagePage = renderToStaticMarkup(
    createElement(MessageBody, { body: stored })
  );
  const onTaskPage = toRichTextHtml(stored);

  assert.ok(
    onMessagePage.includes(onTaskPage),
    `the two surfaces render different markup:\n${onMessagePage}\n${onTaskPage}`
  );

  // And what both render is formatting, not printed tags.
  for (const surface of [onMessagePage, onTaskPage]) {
    assert.ok(surface.includes("<strong>Sarah</strong>"), surface);
    assert.ok(surface.includes("<em>important</em>"), surface);
    assert.match(surface, /<a[^>]+href="https:\/\/everyfield\.app\/rsvp"/);
    assert.ok(surface.includes("<li>Arrive by 9</li>"), surface);
    assert.ok(!surface.includes("&lt;strong&gt;"), surface);
  }
});

test("the delivered email carries the formatting the task page carries", async () => {
  const stored = toRichTextHtml(FORMATTED_BODY);
  const delivered = await render(
    CommunicationEmail({ bodyHtml: stored, churchName: "New Life" })
  );
  const onTaskPage = toRichTextHtml(stored);

  // The inbox is the one surface with no second chance, so the formatting is
  // asserted there against the same body the task page shows.
  for (const surface of [delivered, onTaskPage]) {
    assert.ok(surface.includes("<strong>Sarah</strong>"), surface);
    assert.ok(surface.includes("<em>important</em>"), surface);
    assert.match(surface, /href="https:\/\/everyfield\.app\/rsvp"/);
    assert.ok(surface.includes("Arrive by 9"), surface);
    assert.ok(!surface.toLowerCase().includes("<script"), surface);
  }
});

test("both flatteners read the same body the same way", () => {
  // The email's text/plain half and the task list's preview are the same
  // question — "what does this say, without the tags" — and a planter who
  // scans the list and then opens the message must not find two texts.
  for (const { name, authored } of SHARED_BODIES) {
    const stored = toRichTextHtml(authored);
    assert.equal(
      taskDescriptionPreview(stored),
      richTextToPlainText(stored),
      name
    );
  }
});

test("neither list surface nor inbox ever shows a tag", () => {
  const stored = toRichTextHtml(FORMATTED_BODY);
  const preview = taskDescriptionPreview(stored) ?? "";

  assert.ok(!preview.includes("<"), preview);
  assert.ok(preview.includes("Sarah"), preview);
  assert.ok(preview.includes("Bring a Bible"), preview);
  // The list keeps the SHAPE of a list, so a bulleted description still reads
  // as one when it is flattened.
  assert.ok(preview.includes("- Arrive by 9"), preview);
});
