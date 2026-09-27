/** Actual action/DB proof for owned communication-template fixtures. No mail is sent. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, messageTemplates, type User } from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";

async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const connection = new URL(process.env.DATABASE_URL!);
  assert.equal(connection.hostname, "localhost");
  assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const [fixturePath, output] = process.argv.slice(2);
  assert.ok(fixturePath?.startsWith("/private/tmp/"));
  assert.ok(output?.startsWith("/private/tmp/"));
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const identity = await db.execute<{ name: string }>(
    sql`select current_database() as name`
  );
  assert.equal(identity.rows[0].name, fixture.database);
  assert.equal(connection.pathname, `/${fixture.database}`);
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, fixture.accounts[0].id));
  assert.equal(owner.seat, "owner");
  let actor: User | null = owner;
  mock.module("@/lib/auth/session", {
    namedExports: {
      verifySession: async () => {
        if (!actor) throw new UnauthorizedError();
        return { user: actor };
      },
      getCurrentSession: async () => ({ user: actor, session: null }),
    },
  });
  mock.module("next/cache", {
    namedExports: { revalidatePath() {}, refresh() {} },
  });
  mock.module("next/navigation", {
    namedExports: {
      redirect() {
        throw new Error("Unexpected redirect");
      },
      unstable_rethrow() {},
    },
  });
  const actions = await import("@/app/(dashboard)/communication/actions");
  const { getTemplate, getTemplates } =
    await import("@/lib/communication/templates");
  const input = {
    name: "Audit custom welcome",
    description: "Owned disposable template proof",
    category: "announcement" as const,
    channel: "email" as const,
    subject: "Welcome {{first_name}}",
    body: "<p><strong>Hello</strong> {{first_name}}, welcome to {{church_name}}.</p>",
  };
  const count = async () =>
    (await db.select({ id: messageTemplates.id }).from(messageTemplates))
      .length;
  const before = await count();
  for (const invalid of [
    { ...input, name: " " },
    { ...input, body: "<p><br></p>" },
    { ...input, body: "<script>alert(1)</script>" },
    { ...input, body: "<style>body{color:red}</style>" },
    { ...input, channel: "sms" },
    { ...input, category: "not-a-category" },
  ])
    await assert.rejects(actions.createTemplateAction(invalid));
  assert.equal(await count(), before);

  const created = await actions.createTemplateAction({
    ...input,
    churchId: fixture.foreignChurchId,
    isSystem: true,
  });
  assert.equal(created.churchId, owner.churchId);
  assert.equal(created.isSystem, false);
  assert.equal(created.sourceTemplateId, null);
  assert.equal(created.channel, "email");
  assert.equal(created.subject, input.subject);
  assert.match(created.bodyHtml!, /<strong>Hello<\/strong>/);
  assert.match(created.body, /Hello {{first_name}}/);
  assert.ok(
    (await getTemplates(owner.churchId!)).some((row) => row.id === created.id)
  );
  assert.equal(
    await getTemplate(created.id, fixture.foreignChurchId),
    undefined
  );

  await actions.updateTemplateAction(created.id, {
    subject: "Corrected {{first_name}}",
  });
  const edited = await getTemplate(created.id, owner.churchId!);
  assert.equal(edited?.subject, "Corrected {{first_name}}");
  assert.equal(edited?.bodyHtml, created.bodyHtml);
  assert.equal(edited?.category, created.category);
  assert.equal(edited?.channel, created.channel);

  // Posting from another plant refuses rather than changing the owned row.
  actor = { ...owner, churchId: fixture.foreignChurchId };
  await assert.rejects(
    actions.updateTemplateAction(created.id, { name: "foreign write" }),
    /another church/
  );
  actor = { ...owner, seat: "member" };
  await assert.rejects(actions.createTemplateAction(input));
  actor = null;
  await assert.rejects(actions.createTemplateAction(input));
  assert.equal(await count(), before + 1);
  actor = owner;

  const [system] = await db
    .insert(messageTemplates)
    .values({
      name: "Audit system original",
      category: "other",
      channel: "email",
      subject: "System subject",
      body: "Original text",
      isSystem: true,
    })
    .returning();
  const fork = await actions.updateTemplateAction(system.id, {
    body: "<p>Plant fork</p>",
  });
  assert.equal(fork.sourceTemplateId, system.id);
  assert.equal(fork.churchId, owner.churchId);
  assert.equal(
    (await getTemplate(system.id, owner.churchId!))?.body,
    "Original text"
  );
  const again = await actions.updateTemplateAction(system.id, {
    subject: "Fork subject",
  });
  assert.equal(again.id, fork.id);
  assert.ok(
    !(await getTemplates(owner.churchId!)).some((row) => row.id === system.id)
  );
  await actions.deleteTemplateAction(fork.id);
  assert.ok(
    (await getTemplates(owner.churchId!)).some((row) => row.id === system.id)
  );
  assert.equal(
    (await getTemplate(system.id, owner.churchId!))?.subject,
    "System subject"
  );

  writeFileSync(
    output,
    JSON.stringify(
      {
        database: fixture.database,
        customTemplateId: created.id,
        systemTemplateId: system.id,
        passed: [
          "invalid fields and non-email creation refused without rows",
          "church-owned rich create and catalog read",
          "cross-plant read/write refusal",
          "member and anonymous create refusal",
          "partial edit preserves omitted fields",
          "system fork idempotence and reset preserve original",
        ],
      },
      null,
      2
    )
  );
  console.log(
    "Owned communication template action proof passed; no mail requested."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
