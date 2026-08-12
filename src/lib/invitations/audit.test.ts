import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { associationEvents } from "@/db/schema";

import {
  associationEventStatement,
  associationOrg,
  churchSubject,
  recordAssociationEvent,
  sendingChurchSubject,
  toSubjectColumns,
} from "./audit";
import { invitationActorFromSession, type InvitationActor } from "./core";

// ============================================================================
// OV-008 — the association audit (#303, WS1).
//
// Four things are asserted, and only the first is about SQL text:
//
//   §1 the INSERT binds the SESSION's user into `actor_user_id`, and there is no
//      parameter a caller could put somebody else's id in;
//   §2 the module is not an endpoint — no `"use server"` directive, and no
//      `"use server"` module republishes it (the #265 rule, applied to the new
//      writer before there is a surface to forget it on);
//   §3 the table is APPEND-ONLY as written: the writer only ever INSERTs, and the
//      schema gives it no `updated_at` to pretend otherwise;
//   §4 the migration is expand-only and its rollback is one clean DROP (HR2).
//
// The `associationOrg` derivation is unit-tested alongside §1: getting it wrong
// attributes a sever to the wrong org, which an audit cannot afford.
// ============================================================================

const CHURCH = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const FOREIGN_ID = "55555555-5555-4555-8555-555555555555";
const INVITATION_ID = "77777777-7777-4777-8777-777777777777";

const SRC = path.join(process.cwd(), "src");
const AUDIT_PATH = path.join(SRC, "lib/invitations/audit.ts");
const SCHEMA_PATH = path.join(SRC, "db/schema/association-event.ts");
const MIGRATION_PATH = path.join(
  SRC,
  "db/migrations/0031_association_events.sql"
);

/** A module with its comments removed — the assertions below are about CODE. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const AUDIT_CODE = codeOf(AUDIT_PATH);
const SCHEMA_CODE = codeOf(SCHEMA_PATH);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, "utf8");
/** The migration's executable half — its rollback instructions are `--` comments. */
const MIGRATION_STATEMENTS = MIGRATION_SQL.replace(/^--.*$/gm, "").trim();

/**
 * Every `"use server"` module in the tree. The directive counts only as the
 * module's FIRST statement — a mention further down (a regex, an array entry) is
 * not one, and over-eager detection is its own bug. Same rule as
 * `service.test.ts`, kept simple here because this test only asks "does any of
 * them RE-EXPORT the audit writer", never "what can it reach".
 */
const SERVER_MODULES: string[] = (function collect(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collect(full));
    } else if (/\.tsx?$/.test(entry)) {
      const prologue = /^(?:\s*(?:"[^"\n]*"|'[^'\n]*')\s*;?)*/.exec(
        codeOf(full)
      )?.[0];
      if (prologue && /["']use server["']/.test(prologue)) found.push(full);
    }
  }
  return found;
})(SRC);

const ACTOR: InvitationActor = invitationActorFromSession({
  user: {
    id: ACTOR_ID,
    role: "planter",
    churchId: CHURCH,
    sendingChurchId: null,
    sendingNetworkId: null,
  },
});

// ----------------------------------------------------------------------------
// 1. The actor is the session's, and nothing else can be
// ----------------------------------------------------------------------------

test("the audit row is attributed to the session's user", () => {
  // Read off the generated SQL rather than trusted from the source: this is the
  // property the whole table depends on. An audit row whose `actor_user_id` a
  // caller could name records nothing — it is a forgery surface with a
  // timestamp.
  const { sql, params } = associationEventStatement(ACTOR, {
    subject: churchSubject(CHURCH),
    orgType: "sending_church",
    orgId: SENDING_CHURCH,
    event: "disassociated",
  }).toSQL();

  assert.match(sql, /insert into "association_events"/i);
  assert.match(sql, /"actor_user_id"/);
  assert.ok(params.includes(ACTOR_ID), "the actor's id is bound");
  assert.ok(params.includes(CHURCH));
  assert.ok(params.includes(SENDING_CHURCH));
  assert.ok(params.includes("disassociated"));
  assert.ok(!params.includes(FOREIGN_ID));
});

test("no caller can name the actor", () => {
  // The compile-time half. `AssociationEventFacts` is what a caller controls and
  // it has no actor field, so "attribute this to whoever the request said"
  // cannot be written; an unused `@ts-expect-error` is itself an error, so this
  // cannot rot into a comment.
  associationEventStatement(ACTOR, {
    subject: churchSubject(CHURCH),
    orgType: "network",
    orgId: NETWORK,
    event: "associated",
    // @ts-expect-error the actor is minted from the session, never supplied
    actorUserId: FOREIGN_ID,
  });

  // ...and a plain object is not proof of a session. `InvitationActor` is
  // branded, so the only way to obtain one is `invitationActorFromSession`.
  const forged = {
    id: FOREIGN_ID,
    role: "planter" as const,
    churchId: CHURCH,
    sendingChurchId: null,
    sendingNetworkId: null,
  };

  const call = () =>
    associationEventStatement(
      // @ts-expect-error a bare user shape is not an actor
      forged,
      {
        subject: churchSubject(CHURCH),
        orgType: "network",
        orgId: NETWORK,
        event: "associated",
      }
    );

  assert.equal(typeof call, "function");
  // The helper takes an actor, not a uuid — so there is no `(id: string)`
  // overload for a forged POST to reach through either.
  assert.doesNotMatch(AUDIT_CODE, /actorUserId\s*:\s*string/);
  assert.match(AUDIT_CODE, /actorUserId:\s*actor\.id/);
});

test("a missing source invitation is written as null, not omitted", () => {
  // Nullable on purpose: a sever answers no invitation (#277/#278). The column
  // has to say "no invitation is responsible", which is a fact — so the writer
  // binds null rather than leaving the key out and letting a default decide.
  const withInvitation = associationEventStatement(ACTOR, {
    subject: churchSubject(CHURCH),
    orgType: "sending_church",
    orgId: SENDING_CHURCH,
    event: "associated",
    sourceInvitationId: INVITATION_ID,
  }).toSQL();
  assert.ok(withInvitation.params.includes(INVITATION_ID));

  const without = associationEventStatement(ACTOR, {
    subject: churchSubject(CHURCH),
    orgType: "sending_church",
    orgId: SENDING_CHURCH,
    event: "disassociated",
  }).toSQL();
  assert.match(without.sql, /"source_invitation_id"/);
  assert.ok(without.params.includes(null));
});

test("the org pair is derived, and refuses anything that is not exactly one org", () => {
  assert.deepEqual(associationOrg({ sendingChurchId: SENDING_CHURCH }), {
    orgType: "sending_church",
    orgId: SENDING_CHURCH,
  });
  assert.deepEqual(associationOrg({ sendingNetworkId: NETWORK }), {
    orgType: "network",
    orgId: NETWORK,
  });

  // Neither: nothing to audit. Both: genuinely reachable, because
  // `associationStatement` sets one oversight FK without clearing the other — so
  // which org an event is about is a fact only the caller has, and a precedence
  // rule here would attribute a sever to the wrong org.
  assert.equal(associationOrg({}), null);
  assert.equal(
    associationOrg({ sendingChurchId: null, sendingNetworkId: null }),
    null
  );
  assert.equal(
    associationOrg({
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    }),
    null
  );
});

// ----------------------------------------------------------------------------
// 2. Not an endpoint (#265's rule, applied before there is a surface)
// ----------------------------------------------------------------------------

test("the audit writer is not a 'use server' module", () => {
  // In a `"use server"` module every export is a POSTable endpoint reachable
  // with no session and no UI, so exporting `recordAssociationEvent` from one
  // would publish "write any audit row, about any church, attributed to any
  // user" — the exact inverse of an audit. The absence of the directive is what
  // makes it unreachable from a browser.
  assert.doesNotMatch(AUDIT_CODE, /"use server"/);
  assert.doesNotMatch(AUDIT_CODE, /'use server'/);

  // And the module reaches `./core` for the ACTOR TYPE only — a value import
  // would widen every future caller's module graph without saying so.
  assert.match(AUDIT_CODE, /import type \{ InvitationActor \} from "\.\/core"/);
  assert.doesNotMatch(AUDIT_CODE, /^import \{[^}]*\} from "\.\/core"/m);
});

test("no 'use server' module republishes the audit writer", () => {
  // The same transitive rule `service.test.ts` enforces for `./core`: a
  // re-export turns somebody else's function into an endpoint, and a barrel in
  // between hides it. #277/#278 wrap this behind their own session-minted
  // actions instead.
  const offenders = SERVER_MODULES.filter((file) =>
    /^export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*["'][^"']*(?:invitations\/audit|\.\/audit)["']/m.test(
      codeOf(file)
    )
  );

  assert.deepEqual(offenders, []);
});

// ----------------------------------------------------------------------------
// 3. Append-only
// ----------------------------------------------------------------------------

test("the audit writer only ever inserts", () => {
  // An audit row that the audited code can edit records nothing. There is one
  // writer and it has no update or delete path — asserted on the source, since
  // there is no statement to read one off.
  assert.match(AUDIT_CODE, /\.insert\(associationEvents\)/);
  assert.doesNotMatch(AUDIT_CODE, /\.update\(/);
  assert.doesNotMatch(AUDIT_CODE, /\.delete\(/);
  assert.equal(typeof recordAssociationEvent, "function");
});

test("the table gives the code nothing to mutate", () => {
  // No `updated_at`, no soft-delete column: the schema does not offer a shape
  // that an edit could be recorded in, so "append-only" is not merely a
  // convention the next writer has to be told about.
  const columns = Object.keys(associationEvents).filter(
    (key) => !key.startsWith("_") && !key.startsWith("$")
  );

  assert.ok(columns.includes("createdAt"));
  assert.ok(!columns.includes("updatedAt"), columns.join(", "));
  assert.ok(!columns.includes("deletedAt"), columns.join(", "));
  assert.doesNotMatch(SCHEMA_CODE, /updated_at|deleted_at/);

  // EVERY ROW HAS EXACTLY ONE SUBJECT, and since migration 0036 that is the
  // CHECK's job rather than a NOT NULL's. `church_id` became nullable when the
  // table gained a second subject kind (a sending church, #351), so the property
  // that matters — an audit row is never subject-less, which is the shape a null
  // `church_id` would otherwise have meant — is asserted on the constraint.
  assert.match(SCHEMA_CODE, /"association_events_subject_check"/);
  assert.match(
    SCHEMA_CODE,
    /table\.subjectType\} = 'church'[\s\S]*?churchId\} is not null[\s\S]*?subjectSendingChurchId\} is null/
  );
  assert.match(
    SCHEMA_CODE,
    /table\.subjectType\} = 'sending_church'[\s\S]*?subjectSendingChurchId\} is not null[\s\S]*?churchId\} is null/
  );

  // …and the union in the writer is what makes it unwritable from application
  // code: neither arm can produce both ids or neither.
  assert.deepEqual(toSubjectColumns(churchSubject(CHURCH)), {
    subjectType: "church",
    churchId: CHURCH,
    subjectSendingChurchId: null,
  });
  assert.deepEqual(toSubjectColumns(sendingChurchSubject(SENDING_CHURCH)), {
    subjectType: "sending_church",
    churchId: null,
    subjectSendingChurchId: SENDING_CHURCH,
  });
});

// ----------------------------------------------------------------------------
// 4. The migration: expand-only, and one clean DROP back out (HR2)
// ----------------------------------------------------------------------------

test("the migration creates the table with its enum CHECKs", () => {
  // `.$type<>()` on a varchar is a compile-time brand and nothing else — the
  // finding migration 0024 acted on. Both closed sets are closed in the DATA.
  assert.match(MIGRATION_STATEMENTS, /CREATE TABLE "association_events"/);
  for (const column of [
    "church_id",
    "org_type",
    "org_id",
    "event",
    "actor_user_id",
    "source_invitation_id",
    "created_at",
  ]) {
    assert.match(MIGRATION_STATEMENTS, new RegExp(`"${column}"`), column);
  }

  assert.match(
    MIGRATION_STATEMENTS,
    /CONSTRAINT "association_events_org_type_check" CHECK \([^)]*in \('sending_church', 'network'\)\)/
  );
  assert.match(
    MIGRATION_STATEMENTS,
    /CONSTRAINT "association_events_event_check" CHECK \([^)]*in \('associated', 'disassociated'\)\)/
  );

  // `source_invitation_id` is the one nullable FK — associations may predate
  // invitations, and a sever answers none.
  assert.match(MIGRATION_STATEMENTS, /"source_invitation_id" uuid,/);
  assert.match(MIGRATION_STATEMENTS, /"church_id" uuid NOT NULL/);
  assert.match(MIGRATION_STATEMENTS, /"actor_user_id" uuid NOT NULL/);

  for (const fk of ["churches", "users", "organization_invitations"]) {
    assert.match(
      MIGRATION_STATEMENTS,
      new RegExp(`REFERENCES "public"\\."${fk}"`),
      fk
    );
  }
});

test("the migration is expand-only and rolls back with one DROP", () => {
  // Expand-only: nothing is dropped, renamed, or altered on a table that
  // already has rows. Every executable statement is a CREATE, or an ALTER of
  // the new table itself.
  assert.doesNotMatch(MIGRATION_STATEMENTS, /\bDROP\b/i);
  assert.doesNotMatch(MIGRATION_STATEMENTS, /\bRENAME\b/i);

  const altered = [
    ...MIGRATION_STATEMENTS.matchAll(/ALTER TABLE "([^"]+)"/g),
  ].map(([, table]) => table);
  assert.deepEqual([...new Set(altered)], ["association_events"]);

  // HR2 — the rollback is written down, in the file, and it is one statement
  // because the table is new and nothing references it.
  assert.match(MIGRATION_SQL, /DROP TABLE IF EXISTS "association_events";/);
  assert.match(MIGRATION_SQL, /DELETE FROM drizzle\.__drizzle_migrations/);
  assert.match(
    MIGRATION_SQL,
    /DO NOT EDIT src\/db\/migrations\/meta\/_journal\.json/
  );
});

test("the migration is in the journal under its own name", () => {
  // A renamed migration whose journal tag still says otherwise is a migration
  // drizzle-kit cannot find.
  const journal = JSON.parse(
    readFileSync(path.join(SRC, "db/migrations/meta/_journal.json"), "utf8")
  ) as { entries: Array<{ tag: string }> };

  assert.ok(
    journal.entries.some((entry) => entry.tag === "0031_association_events"),
    journal.entries.map((entry) => entry.tag).join(", ")
  );
});
