import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock } from "node:test";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { persons, users, communicationRecipients } from "@/db/schema";
import { resend } from "@/lib/email/client";
import { sendCommunication } from "@/lib/communication/send";
async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const fixturePath = process.argv[2];
  assert.ok(fixturePath?.startsWith("/private/tmp/"));
  const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/" + fixtures.database
  );
  const [owner] = await db
    .select()
    .from(users)
    .where(
      and(eq(users.churchId, fixtures.primaryChurchId), eq(users.seat, "owner"))
    );
  const key = crypto.randomUUID().slice(0, 8);
  const people = await db
    .insert(persons)
    .values([
      {
        churchId: owner.churchId!,
        createdBy: owner.id,
        firstName: "Failure " + key,
        lastName: "One",
        email: "failure-one-" + key + "@proof.invalid",
      },
      {
        churchId: owner.churchId!,
        createdBy: owner.id,
        firstName: "Failure " + key,
        lastName: "Two",
        email: "failure-two-" + key + "@proof.invalid",
      },
      {
        churchId: owner.churchId!,
        createdBy: owner.id,
        firstName: "No email " + key,
        lastName: "Recipient",
      },
    ])
    .returning();
  const results = [];
  for (const mode of [
    "single_error",
    "batch_error",
    "exception",
    "no_email",
    "success",
  ]) {
    let calls = 0;
    const fake = async () => {
      calls++;
      if (mode === "exception")
        throw new Error("Synthetic owned QA provider failure");
      return mode === "success"
        ? { data: { id: "qa-" + crypto.randomUUID() }, error: null }
        : {
            data: null,
            error: {
              message: "Synthetic owned QA rejection",
              name: "validation_error",
            },
          };
    };
    const single = mock.method(resend.emails, "send", fake);
    const batch = mock.method(resend.batch, "send", fake);
    try {
      const recipients =
        mode === "no_email"
          ? [people[2].id]
          : mode === "batch_error"
            ? [people[0].id, people[1].id]
            : [people[0].id];
      const comm = await sendCommunication(owner.churchId!, owner.id, {
        channel: "email",
        subject: "Owned failure " + key + " " + mode,
        body: "<p>Owned safe QA</p>",
        recipientIds: recipients,
      });
      const rows = await db
        .select()
        .from(communicationRecipients)
        .where(eq(communicationRecipients.communicationId, comm.id));
      assert.equal(comm.status, mode === "success" ? "sent" : "failed");
      assert.equal(!!comm.sentAt, mode === "success");
      if (mode !== "no_email")
        assert.ok(
          rows.every(
            (r) => r.status === (mode === "success" ? "sent" : "failed")
          )
        );
      results.push({
        mode,
        status: comm.status,
        sentAt: !!comm.sentAt,
        recipientStates: rows.map((r) => r.status),
        calls,
      });
    } finally {
      single.mock.restore();
      batch.mock.restore();
    }
  }
  const capture = new URL(process.env.RESEND_BASE_URL!);
  assert.equal(capture.hostname, "127.0.0.1");
  const subject = "Owned capture success " + key;
  const sent = await sendCommunication(owner.churchId!, owner.id, {
    channel: "email",
    subject,
    body: "<p>Owned capture-only success</p>",
    recipientIds: [people[0].id],
  });
  assert.equal(sent.status, "sent");
  const captured = await (await fetch(new URL("/messages", capture))).json();
  assert.equal(
    captured.filter(
      (message: { subject: string }) => message.subject === subject
    ).length,
    1
  );
  results.push({
    mode: "actual_capture",
    status: sent.status,
    sentAt: !!sent.sentAt,
    recipientStates: ["sent"],
    calls: 1,
  });
  console.log(
    JSON.stringify(
      { kind: "REAL_DB_SYNTHETIC_SDK_NO_NETWORK", results },
      null,
      2
    )
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
