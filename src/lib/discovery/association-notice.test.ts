import assert from "node:assert/strict";
import { test } from "node:test";
import {
  announceDiscoveryAssociationChange,
  type DiscoveryAssociationChange,
} from "./association-notice";

type Deps = NonNullable<
  Parameters<typeof announceDiscoveryAssociationChange>[1]
>;
type Facts = NonNullable<Awaited<ReturnType<NonNullable<Deps["load"]>>>>;
type Message = Parameters<NonNullable<Deps["send"]>>[0];
const change: DiscoveryAssociationChange = {
  userId: "explorer",
  orgType: "network",
  orgId: "network-a",
  event: "accepted",
  occurrence: "event-1",
};
const owner: Facts["ownerCandidates"][number] = {
  id: "owner",
  email: "owner@example.test",
  seat: "owner",
  churchId: null,
  sendingChurchId: null,
  sendingNetworkId: "network-a",
};
const facts: Facts = {
  account: {
    id: "explorer",
    name: "Alex <script>alert(1)</script>",
    email: "explorer@example.test",
  },
  orgName: "North & South",
  ownerCandidates: [owner],
};

async function capture(input = change, data = facts) {
  const messages: Message[] = [];
  const outcome = await announceDiscoveryAssociationChange(input, {
    load: async () => data,
    baseUrl: "https://example.test",
    send: async (message) => {
      messages.push(message);
      return { success: true };
    },
  });
  return { outcome, messages };
}

test("all discovery lifecycle events send personal receipts through the email rail", async () => {
  for (const event of ["accepted", "declined", "left", "removed"] as const) {
    const { outcome, messages } = await capture({ ...change, event });
    assert.deepEqual(outcome, { sent: 2, failed: 0 });
    assert.deepEqual(
      messages.map((message) => message.to),
      [facts.account.email, owner.email]
    );
    assert.match(messages[0].text, /discovery association/i);
    assert.match(messages[0].text, /https:\/\/example.test\/dashboard/);
    assert.match(messages[1].text, /https:\/\/example.test\/oversight/);
    assert.doesNotMatch(messages[1].html, /<script>/);
    assert.match(messages[1].html, /&lt;script&gt;/);
    for (const message of messages) {
      assert.doesNotMatch(message.text, /church plant|billable|seat granted/i);
      assert.ok(message.html.length < 102_000);
    }
  }
});

test("only exact-tenancy Owners join the subject's audience", async () => {
  const { messages } = await capture(change, {
    ...facts,
    ownerCandidates: [
      owner,
      owner,
      { ...owner, id: "admin", seat: "admin" },
      { ...owner, id: "member", seat: "member" },
      { ...owner, id: "seatless", seat: null },
      { ...owner, id: "foreign", sendingNetworkId: "other" },
      { ...owner, id: "plant", churchId: "plant-a" },
      { ...owner, id: "two-orgs", sendingChurchId: "sender-a" },
    ],
  });
  assert.deepEqual(
    messages.map((message) => message.to),
    [facts.account.email, owner.email]
  );
  const sender = await capture(
    { ...change, orgType: "sending_church", orgId: "sender-a" },
    {
      ...facts,
      ownerCandidates: [
        { ...owner, sendingNetworkId: null, sendingChurchId: "sender-a" },
      ],
    }
  );
  assert.equal(sender.messages.length, 2);
});

test("provider keys are stable by occurrence and distinct across recipient, event and relationship", async () => {
  const original = (await capture()).messages.map(
    (message) => message.idempotencyKey
  );
  assert.deepEqual(
    (await capture()).messages.map((message) => message.idempotencyKey),
    original
  );
  assert.notEqual(original[0], original[1]);
  for (const input of [
    { ...change, occurrence: "event-2" },
    { ...change, event: "left" as const },
    { ...change, orgId: "other" },
    { ...change, orgType: "sending_church" as const },
  ]) {
    const next = (await capture(input)).messages[0].idempotencyKey;
    assert.notEqual(next, original[0]);
    assert.ok(next.length <= 256);
    assert.doesNotMatch(next, /@/);
  }
});

test("one recipient's transport failure does not suppress another receipt", async () => {
  for (const throws of [true, false]) {
    const sent: string[] = [];
    const result = await announceDiscoveryAssociationChange(change, {
      load: async () => facts,
      baseUrl: "https://example.test",
      send: async (message) => {
        sent.push(message.to);
        if (message.to === facts.account.email) {
          if (throws) throw new Error("private provider payload");
          return { success: false };
        }
        return { success: true };
      },
    });
    assert.deepEqual(result, { sent: 1, failed: 1 });
    assert.equal(sent.length, 2);
  }
});

test("missing or mismatched subject and failed preparation send nothing and do not throw", async () => {
  for (const load of [
    async () => null,
    async () => ({
      ...facts,
      account: { ...facts.account, id: "another-user" },
    }),
    async () => {
      throw new Error("database unavailable");
    },
  ]) {
    assert.deepEqual(
      await announceDiscoveryAssociationChange(change, {
        load,
        send: async () => {
          assert.fail("must not send");
        },
      }),
      { sent: 0, failed: 1 }
    );
  }
});

test("discovery invitations and resends open the existing-account invitation list", async () => {
  process.env.RESEND_API_KEY ??= "re_discovery_test_unused";
  const { buildInvitationEmail } = await import("../invitations/email");
  for (const type of [
    "discovery_to_network",
    "discovery_to_sending_church",
  ] as const) {
    const invitation = {
      invitationId: "invitation-1",
      inviteeEmail: "explorer@example.test",
      status: "pending" as const,
      type,
      invitingOrgName: "Supporting org",
      expiresAt: null,
    };
    const first = await buildInvitationEmail(
      invitation,
      "https://example.test"
    );
    const resend = await buildInvitationEmail(
      invitation,
      "https://example.test",
      { kind: "resend", at: new Date("2026-09-11T12:00:00Z") }
    );
    assert.ok(first.ok && resend.ok);
    assert.match(first.message.text, /https:\/\/example.test\/dashboard/);
    assert.match(first.message.text, /Review invitation/);
    assert.match(first.message.text, /does not create a church plant/);
    assert.doesNotMatch(
      first.message.text,
      /Accept and create|\/register\?|set up your discovery/
    );
    assert.notEqual(
      first.message.idempotencyKey,
      resend.message.idempotencyKey
    );
    assert.deepEqual(
      await buildInvitationEmail({ ...invitation, status: "revoked" }),
      { ok: false, reason: "not_pending" }
    );
  }
});
