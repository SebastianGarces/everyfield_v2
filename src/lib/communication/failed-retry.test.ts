import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { render } from "@react-email/components";
import {
  CommunicationEmailText,
  CONFIRM_PLACEHOLDER,
  DECLINE_PLACEHOLDER,
} from "@/lib/email/components/communication-email";
import {
  failedCommunicationSourceSchema,
  failedRetryOutboundSchema,
  FAILED_RETRY_SAFE_WINDOW_HOURS,
} from "./failed-retry";
import { classifyEvryCommunicationProviderError } from "./evry-send";
import { COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA } from "@/lib/evry/capabilities/communication/messages";
import { CONTENT_MODEL_PREPARATIONS } from "@/lib/evry/capabilities/preparations/content";

const id = "10000000-0000-4000-8000-000000000001";
const source = {
  id,
  subject: "Invitation",
  body: "Join us",
  bodyHtml: null,
  channel: "email",
  templateId: null,
  meetingId: null,
  recipients: [
    {
      id,
      personId: id,
      email: "person@example.test",
      externalId: "provider-accepted-id",
      failureOrigin: "provider_delivery_failed",
    },
  ],
};

test("native and Evry senders forward both RSVP URLs to the plain-text renderer", async () => {
  for (const [file, prefix] of [
    ["evry-send.ts", ""],
    ["send.ts", "p."],
  ]) {
    const code = readFileSync(`src/lib/communication/${file}`, "utf8");
    const calls = [...code.matchAll(/CommunicationEmailText\(\{([^}]+)\}\)/g)];
    assert.equal(calls.length, 1, file);
    for (const name of ["confirmUrl", "declineUrl"]) {
      assert.ok(
        calls[0][1].includes(
          prefix ? `${name}: ${prefix}${name},` : `${name},`
        ),
        `${file} must pass ${name} to the text renderer`
      );
    }
  }
  const confirmUrl = "https://example.test/rsvp/fixture-token";
  const declineUrl = `${confirmUrl}?action=decline`;
  const text = await render(
    CommunicationEmailText({
      body: `Join us\n${CONFIRM_PLACEHOLDER}\n${DECLINE_PLACEHOLDER}`,
      confirmUrl,
      declineUrl,
      churchName: "Fixture church",
    }),
    { plainText: true }
  );
  assert.ok(text.includes(confirmUrl));
  assert.ok(text.includes(declineUrl));
  assert.ok(text.includes("I'll be there"));
  assert.ok(text.includes("Can't make it"));
  assert.ok(!text.includes(CONFIRM_PLACEHOLDER));
  assert.ok(!text.includes(DECLINE_PLACEHOLDER));
});

test("failed retry source requires typed failure provenance and exact original delivery identities", () => {
  assert.equal(failedCommunicationSourceSchema.safeParse(source).success, true);
  for (const failureOrigin of [
    null,
    "evry-attempted:timeout",
    "local_failure",
    undefined,
  ]) {
    assert.equal(
      failedCommunicationSourceSchema.safeParse({
        ...source,
        recipients: [{ ...source.recipients[0], failureOrigin }],
      }).success,
      false
    );
  }
  assert.equal(
    failedCommunicationSourceSchema.safeParse({ ...source, recipients: [] })
      .success,
    false
  );
  assert.equal(
    failedCommunicationSourceSchema.safeParse({
      ...source,
      recipients: Array(101).fill(source.recipients[0]),
    }).success,
    false
  );
  assert.equal(
    failedCommunicationSourceSchema.safeParse({
      ...source,
      recipients: [{ ...source.recipients[0], externalId: "" }],
    }).success,
    false
  );
});

test("model retry preparation accepts only source and optional delivery selection, not replacement content or provenance", () => {
  const preparation = CONTENT_MODEL_PREPARATIONS.find(
    (p) => p.id === "communication.retry_failed"
  );
  assert.ok(preparation);
  assert.deepEqual(preparation.capabilityIdentities, [
    "communication.messages.send",
  ]);
  assert.equal(
    preparation.inputSchema.safeParse({ communicationId: id }).success,
    true
  );
  assert.equal(
    preparation.inputSchema.safeParse({
      communicationId: id,
      recipientIds: [id],
    }).success,
    true
  );
  assert.equal(
    preparation.inputSchema.safeParse({
      communicationId: id,
      body: "different",
    }).success,
    false
  );
  assert.equal(
    preparation.inputSchema.safeParse({ communicationId: id, source }).success,
    false
  );
  const plan = {
    communicationId: id,
    recipientSource: { kind: "failed_recipients", source, excludedCount: 1 },
    audience: {
      subject: "Invitation",
      body: "Join us",
      bodyHtml: "<p>Join us</p>",
      channel: "email",
      templateId: null,
      meetingId: null,
      messageClass: "relationship_message",
      recipients: [
        {
          personId: id,
          label: "Person",
          email: "person@example.test",
          subject: "Invitation",
          bodyHtml: "<p>Join us</p>",
          bodyText: "Join us",
        },
      ],
      exclusions: [],
    },
  };
  assert.equal(
    COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA.safeParse(plan).success,
    true
  );
});

test("uncertain retry payload includes sender, HTML and text, with a shorter than provider-retention bound", () => {
  const payload = {
    from: "Church <church@example.test>",
    to: "person@example.test",
    subject: "Invitation",
    html: "<p>Join</p>",
    text: "Join",
  };
  assert.equal(failedRetryOutboundSchema.safeParse(payload).success, true);
  assert.equal(
    failedRetryOutboundSchema.safeParse({ ...payload, from: undefined })
      .success,
    false
  );
  assert.ok(
    FAILED_RETRY_SAFE_WINDOW_HOURS > 0 && FAILED_RETRY_SAFE_WINDOW_HOURS < 24
  );
  assert.equal(
    classifyEvryCommunicationProviderError({
      statusCode: 409,
      name: "concurrent_idempotent_requests",
    }).status,
    "retryable"
  );
  assert.equal(
    classifyEvryCommunicationProviderError({
      statusCode: 409,
      name: "invalid_idempotent_request",
    }).status,
    "permanent"
  );
});

test("durable source claim is unique, retention is explicit, legacy failures are not backfilled", () => {
  const ddl = readFileSync(
    "src/db/migrations/0080_communication_failed_retry.sql",
    "utf8"
  );
  assert.match(ddl, /"source_recipient_id" uuid PRIMARY KEY NOT NULL/);
  assert.match(
    ddl,
    /CREATE UNIQUE INDEX "comm_failed_retries_child_unique_idx"/
  );
  assert.match(ddl, /ON DELETE restrict/);
  assert.doesNotMatch(ddl, /UPDATE\s+"?communication_recipients/i);
  const webhook = readFileSync("src/app/api/webhooks/resend/route.ts", "utf8");
  assert.match(
    webhook,
    /case "email.failed":[\s\S]*?updates.failureOrigin = "provider_delivery_failed"/
  );
  assert.ok(
    webhook.indexOf("resend.webhooks.verify") <
      webhook.indexOf("updates.failureOrigin")
  );
});
