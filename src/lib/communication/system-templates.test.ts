import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MERGE_FIELDS,
  renderEmailBodyHtml,
  renderEmailBodyText,
  validateMergeFields,
} from "@/lib/communication/merge";
import { SYSTEM_TEMPLATES } from "@/lib/communication/system-templates";
import { toRichTextHtml } from "@/lib/rich-text/format";

// ----------------------------------------------------------------------------
// #625 — the catalog's half of "an optional token owns its line"
//
// The engine's half is in `merge.test.ts`: a line holding one emptied token
// disappears. That is only a fix if the TEMPLATE puts nothing else on the line,
// and for four templates it did — `📍 {{meeting_location}}` shipped the pin as
// literal body text, so a meeting with no location delivered a bare 📍.
//
// These walk the catalog rather than naming the four, so the fifth template
// someone writes is covered without anyone remembering this.
// ----------------------------------------------------------------------------

/**
 * The fields whose value can be `""` — read off the registry, never re-listed
 * here, so adding one to `MERGE_FIELDS` puts every template under this rule.
 */
const OPTIONAL_TOKENS = new Set(
  MERGE_FIELDS.filter((field) => field.optional).map((field) => field.name)
);

/** Which optional tokens this body line mentions. */
function optionalTokensOn(line: string): string[] {
  return [...line.matchAll(/\{\{(\w+)\}\}/g)]
    .map((match) => match[1])
    .filter((name) => OPTIONAL_TOKENS.has(name));
}

test("an optional token is the ONLY thing on its line, in every seeded template", () => {
  // The prefix belongs INSIDE the value (`merge.ts`). Anything else sharing the
  // line — a 📍, an "Agenda:", a "Where:" — survives the value it introduces,
  // because the merge engine has no conditionals and the drop rule can only
  // delete a whole line.
  for (const template of SYSTEM_TEMPLATES) {
    for (const line of template.body.split("\n")) {
      const optional = optionalTokensOn(line);
      if (optional.length === 0) continue;

      assert.equal(
        line.trim(),
        `{{${optional[0]}}}`,
        `"${template.name}" writes more than {{${optional[0]}}} on one line: ` +
          `"${line}" — that text outlives an empty value. Move it into the ` +
          `value (see formatLocationForEmail / formatAgendaForEmail).`
      );
    }
  }
});

test("no seeded template names a merge field that does not exist", () => {
  for (const template of SYSTEM_TEMPLATES) {
    assert.deepEqual(
      validateMergeFields(`${template.subject}\n${template.body}`),
      [],
      `"${template.name}" uses an unknown merge field`
    );
  }
});

// ----------------------------------------------------------------------------
// The whole path, on every template that invites a meeting
// ----------------------------------------------------------------------------

/** What a meeting with nothing optional on it renders to. */
const BARE_MEETING = {
  first_name: "Sarah",
  church_name: "New Life",
  meeting_title: "Vision Meeting #5",
  meeting_type: "Vision Meeting",
  meeting_date: "Tuesday, September 22, 2026 at 6:30 PM",
  meeting_location: "",
  meeting_agenda: "",
  confirm_link: "__EF_CONFIRM__",
  decline_link: "__EF_DECLINE__",
};

const invitations = SYSTEM_TEMPLATES.filter((template) =>
  template.body.includes("{{meeting_location}}")
);

test("the catalog still has the templates these assertions are about", () => {
  // A guard that silently covers zero templates is not a guard. Four today: the
  // three invitations plus the vision-meeting reminder.
  assert.equal(invitations.length, 4);
});

for (const template of invitations) {
  test(`"${template.name}" — no location leaves no pin and no gap`, () => {
    const html = renderEmailBodyHtml(toRichTextHtml(template.body), {
      ...BARE_MEETING,
    });

    assert.ok(!html.includes("📍"), html);
    assert.ok(!/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/.test(html), html);
    // The date line kept its own break-free paragraph rather than a dangling
    // `<br>` where the location used to be.
    assert.ok(!/<br\s*\/?>\s*<\/p>/.test(html), html);
    // A section that is absent, not a body that lost its middle.
    assert.ok(html.includes("Hi Sarah"), html);
    assert.ok(html.includes("September 22, 2026"), html);

    const text = renderEmailBodyText(template.body, { ...BARE_MEETING });
    assert.ok(!text.includes("📍"), text);
    assert.ok(!/\n{3,}/.test(text), text);
  });

  test(`"${template.name}" — a location renders once, with one pin`, () => {
    const data = {
      ...BARE_MEETING,
      meeting_location: "📍 Fellowship Hall, 400 Oak St",
    };
    const html = renderEmailBodyHtml(toRichTextHtml(template.body), data);

    assert.equal(html.match(/📍/g)?.length, 1, html);
    assert.ok(html.includes("📍 Fellowship Hall, 400 Oak St"), html);
    // Still one line under the date, not a paragraph of its own.
    assert.match(html, /📅[^<]*<br\s*\/?>📍/);
  });
}
