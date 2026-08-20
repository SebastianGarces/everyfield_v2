-- persons.user_id — the person↔user link (#378 WS1, AS-013, ruled 2026-08-09).
-- This file adds the column, its FK, the one-per-account-per-church index, and
-- backfills a row for every plant Owner that already exists. 0053 is the next
-- file and carries `ministry_teams.template_key`, the rename and the leadership
-- reconcile; the reconcile READS this link, so it cannot share this one.
--
-- WHAT THE LINK IS FOR. `ministry_teams.leader_id`, the meeting guest list and
-- every team assignment reference `persons.id`, and the assignment dialog is
-- fed by `listPeople`. Until now nothing tied a `persons` row to an account, so
-- the planter was the one member of their own plant who could not be put on a
-- team: they staffed everybody except themselves.
--
-- WHAT IT IS NOT. It grants NOTHING. Authority is the seat held in a tenancy
-- (`memory/invariants/seats-and-tenancy.md`) and no capability, no seat and no
-- oversight reach is derived from this column. It makes an account ADDRESSABLE
-- as a person, which is a different question from what that account may do.
--
-- ============================================================================
-- §1 — THE INDEX GOES IN BEFORE THE ROWS
-- ============================================================================
--
-- `churchCreationStatements` writes this row with `ON CONFLICT (church_id,
-- user_id) WHERE user_id IS NOT NULL DO NOTHING`, and `ON CONFLICT` against a
-- database lacking the index is SQLSTATE 42P10 on EVERY church creation, not a
-- degraded path (`memory/invariants.md` → Transactions). Nothing here applies
-- migrations on deploy, so the index is created before the backfill in this
-- same file and the code that speaks for it ships after an operator has run
-- `pnpm db:migrate`.
--
-- PARTIAL ON `user_id IS NOT NULL`. A btree unique index treats NULLs as
-- distinct, so the 581 unlinked contacts on the shared branch would index
-- separately anyway; the predicate says so out loud and keeps them out of the
-- index entirely. Church-scoped rather than per-account, because the row is a
-- person IN A PLANT and nothing in the schema holds an account to one tenancy
-- (`memory/invariants.md` → Seats & Tenancy, the accepted residual).
--
-- ============================================================================
-- §2 — THE BACKFILL, AND THE FIGURES BEHIND IT
-- ============================================================================
--
-- Measured 2026-08-20 against the shared development branch, read-only:
--
--   church-level Owners (church_id IS NOT NULL AND seat = 'owner')  ..... 31
--   ... of those, with a person in their church sharing their address ...  0
--   persons rows in total ............................................. 581
--   Owners matching MORE THAN ONE such person .......................... 0
--
-- so on that database §2a links nothing and §2b inserts 31 rows. Both ship
-- regardless: a migration that only converges on the database somebody happened
-- to measure is not idempotent, and a local, a preview or a restored dump will
-- have different numbers.
--
-- MATCH BEFORE MINT, WHICH IS THE WHOLE ORDER OF §2. A plant whose planter
-- already typed themselves into their own people list must not end up with two
-- rows for one human, so §2a claims an existing row by exact address within the
-- church and only §2b creates what is left. `DISTINCT ON (u.id)` is what keeps
-- §2a inside the new index when a church holds two contacts at one address:
-- one person per Owner, the oldest row, deterministically.
--
-- Addresses are compared case-insensitively because `users.email` is stored
-- lowercased and `persons.email` is typed by hand — the same rule
-- `src/lib/people/person-user.ts` applies to the address bridge it owns.
--
-- SOFT-DELETED PEOPLE ARE NOT CLAIMED. A planter who deleted a person record
-- said something about it, and adopting that row as their account's identity
-- would undo it silently. Such a plant gets a fresh row from §2b instead.
--
-- AN ADOPTED ROW KEEPS ITS OWN NAME AND STATUS. §2a writes `user_id` and
-- nothing else — the plant typed that record in, so overwriting their spelling
-- of the planter's name, or moving them up the pipeline, would be this
-- migration having an opinion about data it did not create. Only the rows §2b
-- MINTS carry `status = 'leader'` and the split name.
--
-- WHY `status = 'leader'`. `persons.status` is a RECRUITMENT pipeline and it
-- describes how far somebody the plant is gathering has come. The planter is
-- not a recruit — `prospect` would put the person who owns the plant at the
-- bottom of their own funnel and into every "new prospects" count. It is also
-- the value that survives the team assignment this link exists for:
-- `autoAdvanceStatus` moves a person only from an exact `from`, so neither
-- `team.member.assigned` nor `team.leader.assigned` can demote them.
-- `src/lib/people/account-person.ts` is the one spelling of these values; this
-- statement is its SQL twin and the two change together.
--
-- THE NAME SPLIT IS THE SAME RULE IN SQL. `users.name` is one nullable column
-- and `persons` stores two NOT NULL ones: first whitespace word is the given
-- name, the whole remainder the family name, a one-word name keeps an empty
-- `last_name` rather than an invented one, and an account with no name at all
-- falls back to the address's local part so nothing renders as a blank line.
--
-- NO TIMELINE ACTIVITY IS WRITTEN. `createPerson()` is the ONE writer of the
-- `person_created` activity (`memory/invariants.md` → People) and these rows do
-- not go through it — an activity feed opening with "somebody added you" on the
-- planter's own record is noise about a row nobody typed in.
--
-- ============================================================================
-- §3 — ROLLBACK
-- ============================================================================
--
--   DROP INDEX IF EXISTS "persons_church_user_unique_idx";
--   ALTER TABLE "persons" DROP CONSTRAINT IF EXISTS "persons_user_id_users_id_fk";
--   ALTER TABLE "persons" DROP COLUMN IF EXISTS "user_id";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787227880551;
--
-- Roll 0053 back FIRST if it has been applied — its reconcile reads this link.
--
-- WHAT A ROLLBACK LEAVES BEHIND, NAMED: the rows §2b INSERTED. Dropping the
-- column loses the only record of which `persons` rows this file minted, so
-- they survive as ordinary contacts at `status = 'leader'` carrying the Owner's
-- address. Re-applying re-links them through §2a rather than duplicating them,
-- which is exactly what §2a's match-before-mint order is for — so the pair
-- rollback/re-apply converges, and only a rollback ALONE leaves the residue.
-- To clear it too, before dropping the column:
--
--   DELETE FROM "persons" WHERE "user_id" IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM "team_memberships" m WHERE m."person_id" = "persons"."id")
--     AND NOT EXISTS (SELECT 1 FROM "ministry_teams" t WHERE t."leader_id" = "persons"."id");
--
-- (guarded, because §2a may have claimed a row the plant typed in itself).
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023-0051: the journal is the repository's list of
-- migrations, `drizzle.__drizzle_migrations` is the database's record of what
-- ran, and only the ledger row is deleted.
--
-- NO SIBLING RECONCILE OWED. `when` 1787227880551 is above every entry in the
-- journal — head was 0051 at 1787201066871 — so nothing is silently skipped
-- (`memory/invariants.md` → Migrations).

ALTER TABLE "persons" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- §1. The arbiter, before any row it speaks for.
CREATE UNIQUE INDEX "persons_church_user_unique_idx" ON "persons" USING btree ("church_id","user_id") WHERE "persons"."user_id" is not null;--> statement-breakpoint
-- §2a. MATCH: adopt the person the plant already has at the Owner's address.
-- `DISTINCT ON (u."id")` picks exactly one per Owner — oldest first, then id —
-- so a church holding two contacts at one address cannot violate §1's index.
UPDATE "persons" p
SET "user_id" = m."user_id",
	"updated_at" = now()
FROM (
	SELECT DISTINCT ON (u."id") u."id" AS "user_id", c."id" AS "person_id"
	FROM "users" u
	JOIN "persons" c
		ON c."church_id" = u."church_id"
		AND c."user_id" IS NULL
		AND c."deleted_at" IS NULL
		AND lower(c."email") = lower(u."email")
	WHERE u."church_id" IS NOT NULL
		AND u."seat" = 'owner'
	ORDER BY u."id", c."created_at", c."id"
) m
WHERE p."id" = m."person_id";--> statement-breakpoint
-- §2b. MINT: every remaining plant Owner gets a person row of their own.
-- Measured 31 on the shared branch (see the header). The name split mirrors
-- `accountPersonName` in `src/lib/people/account-person.ts`.
INSERT INTO "persons" ("church_id", "user_id", "created_by", "first_name", "last_name", "email", "status")
SELECT
	u."church_id",
	u."id",
	u."id",
	COALESCE(split_part(n."clean", ' ', 1), NULLIF(split_part(u."email", '@', 1), ''), u."email"),
	COALESCE(
		CASE WHEN position(' ' IN n."clean") > 0
			THEN substr(n."clean", position(' ' IN n."clean") + 1)
		END,
		''
	),
	u."email",
	'leader'
FROM "users" u
CROSS JOIN LATERAL (
	SELECT NULLIF(btrim(regexp_replace(COALESCE(u."name", ''), '\s+', ' ', 'g')), '') AS "clean"
) n
WHERE u."church_id" IS NOT NULL
	AND u."seat" = 'owner'
	AND NOT EXISTS (
		SELECT 1 FROM "persons" p
		WHERE p."church_id" = u."church_id" AND p."user_id" = u."id"
	)
ON CONFLICT ("church_id", "user_id") WHERE "user_id" IS NOT NULL DO NOTHING;
