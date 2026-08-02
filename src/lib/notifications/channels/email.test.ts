// The renderer mints a real unsubscribe token, which needs a real secret, and
// `composeBatchEmail` reads it the way production does — the dispatcher does
// not pass one through.
//
// This assignment does NOT run before the module graph is loaded: ESM hoists
// the `import`s below above it. It works because `unsubscribeTokenSecret()`
// reads `process.env` at CALL time inside the function rather than capturing it
// into a module-level constant at import time, so setting it any time before
// the first compose is enough.
process.env.UNSUBSCRIBE_TOKEN_SECRET = "test-unsubscribe-secret-0123456789";
process.env.NEXT_PUBLIC_APP_URL = "https://app.everyfield.test";

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  Notification,
  NotificationDelivery,
  NotificationPreference,
} from "@/db/schema";

import { NOTIFICATION_CATEGORIES, notificationCategories } from "../categories";
import {
  runDispatch,
  type DispatchDeps,
  type EmailSendOutcome,
} from "../dispatch";
import { batchSubject, composeBatchEmail, type OutboundEmail } from "./email";
import { verifyUnsubscribeToken } from "./unsubscribe-token";

// ============================================================================
// The email channel (N-007, N-012, and the email half of N-003).
//
// These are PROVIDER PAYLOAD assertions: the fake `sendEmail` below records
// exactly what would have gone to Resend, and every claim about subjects,
// bodies, batching and unsubscribe links is made against that recorded
// message rather than against an intermediate the dispatcher might not use.
// The whole run — claim, group, render, settle — is the real code; what is
// faked is Postgres and the provider.
// ============================================================================

const SECRET = "test-unsubscribe-secret-0123456789";
const BASE_URL = "https://app.everyfield.test";

const CHURCH = "11111111-1111-4111-8111-111111111111";
const PLANTER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-07-30T09:00:00.000Z");

let sequence = 0;

function notification(overrides: Partial<Notification> = {}): Notification {
  sequence += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, "0")}`,
    churchId: CHURCH,
    recipientUserId: PLANTER,
    category: "tasks",
    type: "task.overdue",
    title: "Book the venue",
    body: "This task was due yesterday.",
    entityType: null,
    entityId: null,
    dedupeKey: null,
    scheduledFor: new Date(NOW.getTime() - 60_000),
    status: "pending",
    readAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Notification;
}

/**
 * The smallest `DispatchDeps` that exercises the real run for ONE recipient:
 * every notification is claimable, every channel claim succeeds, and the
 * provider always accepts. Anything more elaborate is `dispatch.test.ts`'s job
 * — what is under test here is what the provider was handed.
 */
function fakeDeps(
  claimable: Notification[],
  options: {
    preferences?: NotificationPreference[];
    send?: (message: OutboundEmail) => EmailSendOutcome;
  } = {}
): { deps: DispatchDeps; sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  let claimed = false;

  const deps: DispatchDeps = {
    async claimDue() {
      if (claimed) return [];
      claimed = true;
      return claimable.map((row) => ({ ...row, status: "claimed" }));
    },
    async countRemainingDue() {
      return 0;
    },
    async loadRecipients() {
      return [
        {
          id: PLANTER,
          email: "planter@example.test",
          name: "Sam",
          role: "planter" as const,
        },
      ];
    },
    async loadPreferences() {
      return options.preferences ?? [];
    },
    async loadDeliveries(): Promise<NotificationDelivery[]> {
      return [];
    },
    async claimDelivery() {
      return { status: "claimed", attemptCount: 1 };
    },
    async recordTerminalDelivery() {},
    async settleDelivery() {},
    async finishNotification() {},
    async releaseClaims() {},
    async sendEmail(message) {
      sent.push(message);
      return (
        options.send?.(message) ?? {
          status: "sent",
          providerMessageId: "resend-1",
        }
      );
    },
  };

  return { deps, sent };
}

/** The unsubscribe link in a rendered email, or null when there is none. */
function unsubscribeLinkFrom(message: OutboundEmail): string | null {
  const match = message.html.match(
    /https:\/\/app\.everyfield\.test\/api\/notifications\/unsubscribe\?token=[A-Za-z0-9_-]+/
  );
  return match?.[0] ?? null;
}

function tokenFrom(link: string): string {
  return decodeURIComponent(new URL(link).searchParams.get("token") ?? "");
}

// ----------------------------------------------------------------------------
// AC: a delivered notification arrives as an email whose subject and body
// match the caller-rendered content
// ----------------------------------------------------------------------------

test("the provider is handed the caller's own subject and body", async () => {
  const item = notification({
    title: "Follow up with Jane Doe",
    body: "No contact in 30 days.",
  });
  const { deps, sent } = fakeDeps([item]);

  await runDispatch(deps, { now: NOW });

  assert.equal(sent.length, 1);
  const [message] = sent;

  assert.equal(message.to, "planter@example.test");
  // A single notification keeps its own title as the subject — the caller
  // wrote the most specific thing anyone could say about it.
  assert.equal(message.subject, "Follow up with Jane Doe");
  assert.ok(message.html.includes("Follow up with Jane Doe"));
  assert.ok(message.html.includes("No contact in 30 days."));
  assert.ok(message.text.includes("Follow up with Jane Doe"));
  assert.ok(message.text.includes("No contact in 30 days."));
});

// ----------------------------------------------------------------------------
// AC: a grouped batch renders as ONE email listing each notification
// ----------------------------------------------------------------------------

test("a grouped batch is one provider call listing every notification", async () => {
  const items = [
    notification({ title: "Book the venue", body: "Due yesterday." }),
    notification({ title: "Call the landlord", body: "Due today." }),
    notification({ title: "Send the invites", body: "Due tomorrow." }),
  ];
  const { deps, sent } = fakeDeps(items);

  const summary = await runDispatch(deps, { now: NOW });

  // ONE call, not three — the count is the whole point of N-012.
  assert.equal(sent.length, 1);
  assert.equal(summary.emailsSent, 1);

  const [message] = sent;
  // The label LEADS, so the count never has to agree with it grammatically —
  // "3 tasks updates" was the bug this shape retires (ruled 2026-08-01).
  assert.equal(message.subject, "Tasks — 3 updates");

  for (const item of items) {
    assert.ok(
      message.html.includes(item.title),
      `"${item.title}" is missing from the grouped email`
    );
    assert.ok(
      message.html.includes(item.body),
      `"${item.body}" is missing from the grouped email`
    );
    assert.ok(message.text.includes(item.title));
  }

  // And it is a LIST, not three messages glued together: the footer that
  // carries the unsubscribe link appears exactly once.
  assert.equal(
    message.html.split("/api/notifications/unsubscribe").length - 1,
    1
  );
});

test("two categories for the same recipient are two emails, not one merged one", async () => {
  const { deps, sent } = fakeDeps([
    notification({ category: "tasks", title: "Book the venue" }),
    notification({ category: "meetings", title: "Vision meeting Thursday" }),
  ]);

  await runDispatch(deps, { now: NOW });

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((message) => message.subject).sort(), [
    "Book the venue",
    "Vision meeting Thursday",
  ]);
});

// ----------------------------------------------------------------------------
// AC: every email carries a working unsubscribe link
// ----------------------------------------------------------------------------

test("every email carries an unsubscribe link that resolves to that recipient and category", async () => {
  for (const category of ["tasks", "meetings", "phase"] as const) {
    const { deps, sent } = fakeDeps([notification({ category })]);
    await runDispatch(deps, { now: NOW });

    const link = unsubscribeLinkFrom(sent[0]);
    assert.ok(link, `no unsubscribe link in the ${category} email`);

    const verified = verifyUnsubscribeToken(tokenFrom(link), {
      now: NOW,
      secret: SECRET,
    });
    assert.ok(verified.valid, `the ${category} link's token did not verify`);
    assert.equal(verified.userId, PLANTER);
    // The link disables the category the email is ABOUT, never a fixed one.
    assert.equal(verified.category, category);
  }
});

test("the unsubscribe link is in the plain-text part and the List-Unsubscribe header too", async () => {
  const { deps, sent } = fakeDeps([notification()]);
  await runDispatch(deps, { now: NOW });

  const [message] = sent;
  const link = unsubscribeLinkFrom(message);
  assert.ok(link);

  // A reader whose client renders text-only must still be able to opt out.
  assert.ok(message.text.includes("/api/notifications/unsubscribe"));
  // And the mail client's own control is driven by the header.
  assert.equal(message.headers?.["List-Unsubscribe"], `<${link}>`);
});

// ----------------------------------------------------------------------------
// AC: outgoing emails carry the RFC 8058 one-click headers
// ----------------------------------------------------------------------------

test("every email carries the RFC 8058 pair, so one-click survives the move to POST", async () => {
  // The two headers only mean anything together: the first names the URL, the
  // second promises that POSTing to it opts the reader out. Without the second,
  // Gmail and Apple Mail fall back to opening the URL — which now only RENDERS
  // a confirmation page, so the reader would have lost their one-click control
  // when the mutation moved off GET (ruled 2026-08-01).
  for (const category of ["tasks", "meetings", "phase"] as const) {
    const { deps, sent } = fakeDeps([notification({ category })]);
    await runDispatch(deps, { now: NOW });

    const [message] = sent;
    const link = unsubscribeLinkFrom(message);
    assert.ok(link, `no unsubscribe link in the ${category} email`);

    assert.equal(message.headers?.["List-Unsubscribe"], `<${link}>`);
    // Verbatim from RFC 8058 §3.1 — mail clients string-match this.
    assert.equal(
      message.headers?.["List-Unsubscribe-Post"],
      "List-Unsubscribe=One-Click"
    );
    // The header URL is the endpoint that accepts the POST, not the page.
    assert.match(link, /\/api\/notifications\/unsubscribe\?token=/);
  }
});

test("the emailed token is disable-only — it cannot re-subscribe anyone", async () => {
  const { deps, sent } = fakeDeps([notification()]);
  await runDispatch(deps, { now: NOW });

  const link = unsubscribeLinkFrom(sent[0]);
  assert.ok(link);
  const token = tokenFrom(link);

  const asDisable = verifyUnsubscribeToken(token, {
    purpose: "disable",
    now: NOW,
    secret: SECRET,
  });
  assert.ok(asDisable.valid);
  assert.equal(asDisable.purpose, "disable");

  // The capability that sits in an inbox for 180 days can only ever take mail
  // AWAY. Re-enabling needs the short-lived token the confirmation page mints.
  assert.equal(
    verifyUnsubscribeToken(token, {
      purpose: "enable",
      now: NOW,
      secret: SECRET,
    }).valid,
    false
  );
});

test("the email links to the full preference screen as well as the one-category opt-out", async () => {
  const { deps, sent } = fakeDeps([notification()]);
  await runDispatch(deps, { now: NOW });

  assert.ok(sent[0].html.includes(`${BASE_URL}/settings`));
});

test("an email cannot be composed without a working unsubscribe link", async (t) => {
  const previous = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  const previousCron = process.env.CRON_SECRET;
  t.after(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = previous;
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
  });

  delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
  delete process.env.CRON_SECRET;

  const { deps, sent } = fakeDeps([notification()]);
  const summary = await runDispatch(deps, { now: NOW });

  // Nothing reached the provider, the run survived, and the notification is
  // owed another attempt rather than being silently marked delivered.
  assert.equal(sent.length, 0);
  assert.equal(summary.emailsSent, 0);
  assert.equal(summary.retryScheduled, 1);
});

// ----------------------------------------------------------------------------
// Rendering details
// ----------------------------------------------------------------------------

test("caller-rendered copy is escaped in HTML and verbatim in text", async () => {
  const message = await composeBatchEmail(
    { id: PLANTER, email: "planter@example.test", name: null },
    "tasks",
    [
      {
        title: "<script>alert(1)</script>",
        body: 'Jane & "John"',
      },
    ],
    "key",
    { now: NOW, secret: SECRET, baseUrl: BASE_URL }
  );

  assert.ok(!message.html.includes("<script>"));
  assert.ok(message.html.includes("&lt;script&gt;"));
  // The plain-text part carries the copy as the caller wrote it; only HTML
  // needs escaping.
  assert.ok(message.text.includes("<script>alert(1)</script>"));
  assert.ok(message.text.includes('Jane & "John"'));
});

test("batchSubject names the category and the count once there is more than one", () => {
  const one = [{ title: "Book the venue", body: "" }];
  const many = [
    { title: "Book the venue", body: "" },
    { title: "Call the landlord", body: "" },
  ];

  assert.equal(batchSubject("tasks", one), "Book the venue");
  assert.equal(batchSubject("tasks", many), "Tasks — 2 updates");
  assert.equal(batchSubject("meetings", many), "Meetings — 2 updates");
});

test("no category produces an ungrammatical subject, including the plural ones", () => {
  // The regression this shape exists to prevent. Every label in the registry is
  // already plural ("Tasks", "Ministry teams"), so any construction that pastes
  // a count in FRONT of the label reads "3 ministry teams updates". Asserting it
  // across the whole registry means a seventh category cannot reintroduce the
  // bug by having an awkward label.
  const many = [
    { title: "a", body: "" },
    { title: "b", body: "" },
    { title: "c", body: "" },
  ];

  for (const category of notificationCategories) {
    const subject = batchSubject(category, many);
    const label = NOTIFICATION_CATEGORIES[category].label;

    assert.equal(subject, `${label} — 3 updates`);
    // No "<n> <plural label> updates" anywhere in it.
    assert.doesNotMatch(subject, /^\d+\s/);
    assert.doesNotMatch(subject, /s updates/i);
  }
});

test("the idempotency key the dispatcher chose survives composition", async () => {
  const message = await composeBatchEmail(
    { id: PLANTER, email: "planter@example.test", name: "Sam" },
    "tasks",
    [{ title: "Book the venue", body: "Due yesterday." }],
    "notif:church:user:tasks:abc",
    { now: NOW, secret: SECRET, baseUrl: BASE_URL }
  );

  assert.equal(message.idempotencyKey, "notif:church:user:tasks:abc");
});
