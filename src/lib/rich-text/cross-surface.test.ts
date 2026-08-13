import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@react-email/components";

import { EmailPreview } from "@/components/communication/email-preview";
import { RichText } from "@/components/shared/rich-text";
import { renderTemplate } from "@/lib/communication/merge";
import { CommunicationEmail } from "@/lib/email/components/communication-email";
import {
  normalizeTaskDescription,
  taskDescriptionPreview,
} from "@/lib/tasks/descriptions";

import {
  escapeMergeValues,
  richTextToPlainText,
  sanitizeEditorHtml,
  toRichTextHtml,
} from "./format";
import { ALLOWED_TAGS, escapeHtml } from "./sanitize";

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

  // Both detail pages now mount the SAME reader, so this asserts one reader
  // renders one markup rather than two readers agreeing by coincidence — which
  // is what it asserted while the task page hand-rolled its own copy.
  const onMessagePage = renderToStaticMarkup(
    createElement(RichText, { body: stored })
  );
  const onTaskPage = renderToStaticMarkup(
    createElement(RichText, { body: stored })
  );

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

// ============================================================================
// A merge token cannot become a scheme
// ============================================================================
//
// Every surface below runs the same two steps in the same order — sanitise,
// then substitute ESCAPED merge values — and the substitution happens AFTER the
// href was vetted. So `<a href="{{first_name}}">` is the one input where the
// sanitiser's answer and the recipient's URL are different strings, and it has
// to be caught on every one of them at once, not on whichever surface a test
// happened to cover.

test("a merge token cannot smuggle a javascript: href onto any surface", async () => {
  const authored = `<p>Hi <a href="{{first_name}}">click me</a></p>`;
  const hostile = { first_name: "javascript:alert(document.domain)" };

  // The send path's two steps, stripped of their I/O exactly as the email
  // suite strips them (`sendCommunication`: `toRichTextHtml` then
  // `renderTemplate(html, escapeMergeValues(data))`).
  const stored = toRichTextHtml(authored);
  const sent = renderTemplate(stored, escapeMergeValues(hostile));

  const onDetailPage = renderToStaticMarkup(
    createElement(RichText, { body: stored, mergeData: hostile })
  );
  const inPreview = renderToStaticMarkup(
    createElement(EmailPreview, {
      subject: "",
      body: stored,
      mergeData: hostile,
    })
  );
  const delivered = await render(
    CommunicationEmail({ bodyHtml: sent, churchName: "New Life" })
  );

  const surfaces: Array<[string, string]> = [
    ["the send path", sent],
    ["the message detail page", onDetailPage],
    ["the COM-015 preview", inPreview],
    ["the delivered email", delivered],
  ];

  for (const [name, html] of surfaces) {
    assert.ok(!/href\s*=\s*["']?javascript:/i.test(html), `${name}: ${html}`);
    assert.ok(!/javascript:alert/i.test(html), `${name}: ${html}`);
    // The refusal costs the link, never the words.
    assert.ok(html.includes("click me"), `${name}: ${html}`);
  }
});

test("no substituted merge value can decide the host on any surface", async () => {
  // The other half of the same rule. `/{{first_name}}` fixes the scheme and
  // leaves the AUTHORITY to the merge value, so a value beginning with `/`
  // renders `//evil.example/phish` — protocol-relative, resolved against
  // whatever host the mail client is on, and a phishing link in outbound mail.
  const authored = `<p>Hi <a href="/{{first_name}}">click me</a></p>`;
  const hostile = { first_name: "/evil.example/phish" };

  const stored = toRichTextHtml(authored);
  const sent = renderTemplate(stored, escapeMergeValues(hostile));

  const onDetailPage = renderToStaticMarkup(
    createElement(RichText, { body: stored, mergeData: hostile })
  );
  const inPreview = renderToStaticMarkup(
    createElement(EmailPreview, {
      subject: "",
      body: stored,
      mergeData: hostile,
    })
  );
  const delivered = await render(
    CommunicationEmail({ bodyHtml: sent, churchName: "New Life" })
  );

  for (const [name, html] of [
    ["the send path", sent],
    ["the message detail page", onDetailPage],
    ["the COM-015 preview", inPreview],
    ["the delivered email", delivered],
  ] as Array<[string, string]>) {
    assert.ok(!/href\s*=\s*["']?\/\//.test(html), `${name}: ${html}`);
    assert.ok(!/evil\.example/.test(html), `${name}: ${html}`);
    // A refused href costs the link, never the words.
    assert.ok(html.includes("click me"), `${name}: ${html}`);
  }
});

test("a backslash cannot spell the host past the authority rule, on any surface", async () => {
  // The same rule, spelled the way a URL parser reads and a regex does not. `\`
  // folds to `/` for an http(s) base, so `/\{{first_name}}` is `//{{…}}` to the
  // mail client: the merge value picks the HOST. The value here does not even
  // need a leading slash — the backslash supplies it.
  const authored = `<p>Hi <a href="/\\{{first_name}}">click me</a></p>`;
  const hostile = { first_name: "evil.example/phish" };

  const stored = toRichTextHtml(authored);
  const sent = renderTemplate(stored, escapeMergeValues(hostile));

  const onDetailPage = renderToStaticMarkup(
    createElement(RichText, { body: stored, mergeData: hostile })
  );
  const inPreview = renderToStaticMarkup(
    createElement(EmailPreview, {
      subject: "",
      body: stored,
      mergeData: hostile,
    })
  );
  const delivered = await render(
    CommunicationEmail({ bodyHtml: sent, churchName: "New Life" })
  );

  for (const [name, html] of [
    ["the send path", sent],
    ["the message detail page", onDetailPage],
    ["the COM-015 preview", inPreview],
    ["the delivered email", delivered],
  ] as Array<[string, string]>) {
    assert.ok(!/evil\.example/.test(html), `${name}: ${html}`);
    // No backslash reaches any surface at all, so there is nothing left for a
    // URL parser to fold into a slash.
    assert.ok(!html.includes("\\"), `${name}: ${html}`);
    // A refused href costs the link, never the words.
    assert.ok(html.includes("click me"), `${name}: ${html}`);
  }
});

test("a merge token inside a real URL still substitutes on every surface", () => {
  const authored = `<p><a href="https://everyfield.app/rsvp/{{email}}">RSVP</a></p>`;
  const data = { email: "sarah@example.com" };

  const stored = toRichTextHtml(authored);
  const sent = renderTemplate(stored, escapeMergeValues(data));
  const onDetailPage = renderToStaticMarkup(
    createElement(RichText, { body: stored, mergeData: data })
  );

  for (const [name, html] of [
    ["the send path", sent],
    ["the message detail page", onDetailPage],
  ] as Array<[string, string]>) {
    assert.ok(
      html.includes("https://everyfield.app/rsvp/sarah@example.com"),
      `${name}: ${html}`
    );
    assert.ok(!html.includes("{{email}}"), `${name}: ${html}`);
  }
});

// ============================================================================
// Legacy prose survives the door
// ============================================================================

test("a legacy body containing angle brackets keeps every word, both doors", () => {
  // The regression: `isHtmlFragment` matched any `<word …>`, so this prose was
  // routed to the sanitiser and came back as "Bring the  and the keys".
  const legacy = [
    "Bring the <signed lease> and the keys",
    "Call <see notes> before Friday",
    "if a<b and c>d then stop",
    "Ask <the landlord> about parking, then email <someone at the council>",
  ];

  for (const authored of legacy) {
    const { message, task } = throughBothDoors(authored);
    for (const [door, html] of [
      ["the message door", message],
      ["the task door", task],
    ] as Array<[string, string]>) {
      const readBack = richTextToPlainText(html);
      assert.equal(readBack, authored, `${door} lost text: ${html}`);
      for (const word of authored.split(/\s+/)) {
        assert.ok(html.includes(escapeHtml(word)), `${door} dropped ${word}`);
      }
    }
  }
});

// ============================================================================
// Two columns, two shapes: `body` is the plain text, `body_html` is the markup
// ============================================================================
//
// `communications` has held BOTH columns since before COM-017, and they mean
// different things: `body` is the flattened prose message search runs `ilike`
// over (`src/lib/communication/filters.ts`), `body_html` is the sanitised
// markup a reader renders. Storing the markup in `body` regressed search —
// "we are excited" stopped matching `we <strong>are</strong> excited`, and "p"
// started matching every formatted message in the church — so the send path
// writes each shape to its own column, and every reader spells the read one
// way: `bodyHtml ?? body`.
//
// No migration: a row written before COM-017 has `body_html` NULL and plain
// text in `body`, which that same expression already handles.

/** The two columns exactly as `sendCommunication` computes them. */
function storedColumns(composed: string) {
  const bodyHtml = toRichTextHtml(composed);
  return { body: richTextToPlainText(bodyHtml), bodyHtml };
}

test("a formatted body stores no markup in the column search reads", () => {
  const stored = storedColumns(FORMATTED_BODY);

  // The property `ilike(communications.body, …)` depends on: a haystack with
  // no tags in it. A `<` anywhere is a tag search can match or be split by.
  assert.ok(!stored.body.includes("<"), stored.body);
  assert.ok(!stored.body.includes(">"), stored.body);
  // And it is still the words a planter would search for, across what was a
  // formatting boundary.
  assert.ok(stored.body.includes("Hi Sarah, this is important."), stored.body);
  assert.ok(stored.body.includes("Bring a Bible"), stored.body);

  // The markup is not lost — it is in the column built for it.
  assert.ok(
    stored.bodyHtml.includes("<strong>Sarah</strong>"),
    stored.bodyHtml
  );
  assert.match(
    stored.bodyHtml,
    /<a[^>]+href="https:\/\/everyfield\.app\/rsvp"/
  );
});

test("a list that follows a typed line does not glue itself to it", () => {
  // The exact body the toolbar produced during browser validation: an author
  // types a line, then clicks the bullet button, so NO closing block tag stands
  // between the prose and the list. Flattening at closing tags only stored
  // "…and keys- Checklist" — one word for search to miss, in the same string
  // the recipient reads as the text/plain half and the task card shows.
  const stored = storedColumns(
    "Bring the <strong>signed lease</strong> and <em>keys</em>" +
      "<ul><li>Checklist</li></ul>"
  );

  assert.ok(stored.body.includes("and keys\n"), JSON.stringify(stored.body));
  assert.ok(!stored.body.includes("keys- "), JSON.stringify(stored.body));
  assert.ok(stored.body.includes("- Checklist"), JSON.stringify(stored.body));
  // The task card reads the same body the same way.
  assert.equal(taskDescriptionPreview(stored.bodyHtml), stored.body);
});

test("a search phrase that straddles a formatting boundary still matches", () => {
  const stored = storedColumns("<p>we <strong>are</strong> excited</p>");

  assert.ok(stored.body.includes("we are excited"), stored.body);
  // The failure this pins: the markup in the haystack.
  assert.ok(!stored.body.includes("strong"), stored.body);
});

test("`bodyHtml ?? body` reads a new row and a legacy row alike", () => {
  const modern = storedColumns(FORMATTED_BODY);
  // What a row sent before COM-017 holds: prose in `body`, nothing in the
  // markup column.
  const legacy = {
    body: "Call Bob.\n\nHe prefers the morning.",
    bodyHtml: null as string | null,
  };

  const readModern = toRichTextHtml(modern.bodyHtml ?? modern.body);
  const readLegacy = toRichTextHtml(legacy.bodyHtml ?? legacy.body);

  assert.equal(readModern, modern.bodyHtml);
  assert.ok(readLegacy.includes("<p>Call Bob.</p>"), readLegacy);
  assert.ok(readLegacy.includes("<p>He prefers the morning.</p>"), readLegacy);
});

test("the send path really writes each shape to its own column", async () => {
  // The three tests above are about the two VALUES; this one is about the
  // INSERT that stores them, which needs a database to execute. Anchored on
  // declarations through the throw-on-missing reader, so a moved anchor fails
  // loudly instead of asserting about the empty string
  // (`memory/invariants.md` → Multi-Tenancy, the source-span rule).
  const { readFile } = await import("node:fs/promises");
  const { assertInOrder, sourceReader } =
    await import("@/lib/testing/source-span");

  const send = sourceReader(
    await readFile(
      new URL("../communication/send.ts", import.meta.url),
      "utf8"
    ),
    "send.ts"
  );

  const insert = send.span(
    "const [comm] = await db",
    "// 5. Prepare one payload"
  );
  assert.match(insert, /body:\s*safeBodyText/, insert);
  assert.match(insert, /bodyHtml:\s*safeBodyHtml/, insert);

  // ...and the resend reads the pair back the one way.
  assertInOrder(
    send.code,
    "send.ts",
    [
      "export async function resendToNonOpeners",
      "body: original.bodyHtml ?? original.body",
    ],
    "the resend must read the stored body through the same expression every other reader uses"
  );
});
