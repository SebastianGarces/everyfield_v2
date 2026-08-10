import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  organizationInvitationEmail,
  organizationInvitationPreview,
  organizationInvitationSubject,
  type OrganizationInvitationEmailProps,
} from "./organization-invitation";

// ============================================================================
// The invitation template — OV-003b (#293), the render check.
//
// This is the "renders correctly per the react-email / email-best-practices
// checklists" acceptance criterion, executed rather than eyeballed in a preview
// window. Every assertion below is one line of
// `.agents/skills/react-email/SKILL.md` → "Hard rules (email clients, not
// preferences)", and each one is a rule because a real client breaks on it:
//
//   * no flexbox/grid   — Outlook's Word engine ignores both, and the layout
//                         collapses into one unreadable column of overlaps;
//   * no `rem`          — several clients resolve it against nothing and render
//                         text at the default 16px regardless;
//   * no media queries  — Gmail strips `<style>`, so a mobile-only rule is a
//                         desktop-only layout on a phone;
//   * no SVG/WEBP       — Outlook and older Gmail render neither, leaving a
//                         broken-image box where the CTA was;
//   * 102KB             — Gmail CLIPS a longer message, and the clip lands
//                         wherever it lands, which for this email could be
//                         above the button.
//
// The plain-text part is checked here too: it is what a text-only client, a
// screen reader and a spam filter each read, and an HTML-only transactional
// message scores worse with all three.
// ============================================================================

const PROPS: OrganizationInvitationEmailProps = {
  invitingOrgName: "North Texas Church Planting",
  invitingOrgKind: "network",
  inviteeOrgKind: "church plant",
  inviteeEmail: "new-planter@example.test",
  inviteUrl:
    "https://app.everyfield.test/register?invitation=77777777-7777-4777-8777-777777777777",
  expiresLabel: "Thursday, September 3, 2026",
};

const TEMPLATE = path.join(__dirname, "organization-invitation.tsx");
const SOURCE = readFileSync(TEMPLATE, "utf8");

/** Rendered output with its whitespace collapsed — see the note in `../../invitations/email.test.ts`. */
const flat = (part: string) => part.replace(/\s+/g, " ");

test("the template renders both parts, with the link in each", async () => {
  const { subject, html, text } = await organizationInvitationEmail(PROPS);

  assert.equal(
    subject,
    organizationInvitationSubject(PROPS.invitingOrgName),
    "the subject is not the one the template publishes"
  );

  // The CTA and the pasteable fallback are two occurrences of the same URL: a
  // client that strips the button (or a reader who does not trust one) still
  // has an address they can copy.
  assert.ok(
    html.split(PROPS.inviteUrl).length - 1 >= 2,
    "no pasteable fallback for the button"
  );
  assert.ok(text.includes(PROPS.inviteUrl), "the plain part carries no link");

  const flatText = flat(text);
  assert.ok(flatText.includes(PROPS.invitingOrgName));
  assert.ok(flatText.includes(PROPS.inviteeEmail));
  assert.ok(flatText.includes(PROPS.expiresLabel!));
  // The plain part is TEXT: react-email's plain renderer must actually have run.
  assert.doesNotMatch(text, /<(a|div|table)\b/i);
});

test("a row with no expiry renders without one, not with an empty line", async () => {
  const { html, text } = await organizationInvitationEmail({
    ...PROPS,
    expiresLabel: null,
  });

  for (const part of [html, text]) {
    assert.doesNotMatch(part, /expires on/i);
    assert.doesNotMatch(part, /\bnull\b/);
  }
});

test("each audience is told what is true for IT", async () => {
  // A sending church joining a network is not planning a launch and is not the
  // thing whose stage gets listed — its PLANTS are, and each of them still
  // decides its own sharing. One sentence for both audiences told half the
  // readers about something that is not theirs, which is the near-miss that
  // makes a reader wonder whether the message was meant for them at all.
  const plant = flat(
    (
      await organizationInvitationEmail({
        ...PROPS,
        inviteeOrgKind: "church plant",
      })
    ).text
  );
  const sendingChurch = flat(
    (
      await organizationInvitationEmail({
        ...PROPS,
        inviteeOrgKind: "sending church",
      })
    ).text
  );

  assert.match(plant, /a church plant plans its launch/i);
  assert.match(plant, /its name, its stage, its launch countdown/i);

  assert.match(sendingChurch, /keeps track of the plants it supports/i);
  assert.match(sendingChurch, /each of those plants still decides for itself/i);
  assert.doesNotMatch(
    sendingChurch,
    /a sending church plans its launch/i,
    "the sending church was told about a launch it is not planning"
  );
});

test("the preheader fits what a client actually shows", () => {
  // Under 90 characters, or the end of it is truncated in every inbox list —
  // and this one ends on the sentence that matters most ("only works for this
  // address").
  const preview = organizationInvitationPreview("church plant");
  assert.ok(preview.length <= 90, `${preview.length}: ${preview}`);
  assert.ok(preview.length > 20, preview);
  assert.notEqual(
    preview,
    organizationInvitationSubject(PROPS.invitingOrgName),
    "the preheader repeats the subject, wasting the one line after it"
  );
});

test("the rendered HTML breaks none of the email-client hard rules", async () => {
  const { html } = await organizationInvitationEmail(PROPS);

  // Layout: no flexbox, no grid, no media queries, no `rem`.
  assert.doesNotMatch(html, /display:\s*(flex|grid)/i);
  assert.doesNotMatch(html, /@media/i);
  assert.doesNotMatch(html, /:\s*-?[\d.]+rem\b/);

  // Images: none at all in this template, which is the safest answer to
  // "no SVG, no WEBP, absolute URLs, alt text always".
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /\.(svg|webp)\b/i);

  // The document declares its language, so a mail client's screen reader does
  // not announce it in the system default voice.
  assert.match(html, /<html[^>]*\blang="en"/i);

  // The button is a real, tappable, bordered box — `box-sizing` and an explicit
  // border style are both on the skill's hard list, because a client that
  // supplies its own defaults for either reshapes the control.
  const button = html.slice(html.indexOf(PROPS.inviteUrl));
  assert.match(button, /box-sizing:\s*border-box/i);
  assert.match(button, /border:\s*1px solid/i);

  // Gmail clips over 102KB, and the clip can land above the button.
  assert.ok(
    Buffer.byteLength(html, "utf8") < 102 * 1024,
    `${Buffer.byteLength(html, "utf8")} bytes`
  );
});

test("the template holds no unpinned formatter and no provider variables", () => {
  // Dates arrive already formatted, through `@/lib/datetime` at the call site
  // (memory/invariants.md → Date & Time Rendering). A formatter HERE would
  // state the sending process's calendar day, which for a late-UTC expiry is
  // the wrong one — the fault #169 fixed in the meeting reminder.
  assert.doesNotMatch(SOURCE, /\btoLocale(Date|Time)?String\s*\(/);
  assert.doesNotMatch(SOURCE, /from "date-fns"/);
  assert.doesNotMatch(SOURCE, /new Intl\./);

  // `{{name}}` in JSX is a literal, not a variable: it would ship braces to the
  // reader. Props only.
  assert.doesNotMatch(SOURCE, /\{\{\s*\w+\s*\}\}/);
});
