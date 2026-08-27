import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { recipientIdsPayload } from "@/lib/communication/recipient-payload";

import { RecipientPicker } from "./recipient-picker";

const recipients = Array.from({ length: 82 }, (_, index) => ({
  id: `recipient-${index + 1}`,
  firstName: "Recipient",
  lastName: String(index + 1),
  email: `recipient-${index + 1}@example.com`,
}));

test("all 82 selected recipients remain reviewable and removable", () => {
  const html = renderToStaticMarkup(
    createElement(RecipientPicker, { selected: recipients, onChange: () => {} })
  );

  assert.ok(html.includes("82 recipients selected"), html);
  assert.ok(html.includes('role="region"'), html);
  assert.ok(html.includes('aria-label="Selected recipients"'), html);
  assert.ok(html.includes("max-h-48 overflow-y-auto"), html);
  assert.ok(!html.includes("+62 more"), html);

  for (const recipient of recipients) {
    const name = `${recipient.firstName} ${recipient.lastName}`;
    assert.ok(html.includes(name), `${name} missing from ${html}`);
    assert.ok(
      html.includes(`aria-label="Remove ${name}"`),
      `Remove control for ${name} missing from ${html}`
    );
  }
});

test("the send payload preserves the selected recipient ids and their order", () => {
  assert.equal(
    recipientIdsPayload(recipients),
    JSON.stringify(recipients.map((recipient) => recipient.id))
  );
});
