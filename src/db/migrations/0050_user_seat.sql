-- users.seat — the seat model (#494, FRD AS-001 / AS-002, ruling 185 and 185 (4)
-- of 2026-08-20). This file ADDS the seat, backfills it from `role`, repairs the
-- tenancy FKs the seat now has to be read against, and builds the three
-- one-owner-per-tenancy indexes. `role` is dropped by 0051, the next file: the
-- backfill and the repair below both READ it, so the drop cannot share this one.
--
-- Together the pair is ONE WAVE with no compatibility window (ruling 185: "every
-- reader migrates in the same wave and users.role is DROPPED"). Apply both, then
-- deploy — a build that still selects `users.role` breaks the moment 0051 lands,
-- and that is the intended shape, not an accident to be softened with a shim.
--
-- THE MAPPING, from the ruling:
--
--   planter               -> owner     (tenancy: church_id)
--   team_member           -> member    (tenancy: church_id)
--   sending_church_admin  -> owner     (tenancy: sending_church_id)
--   network_admin         -> owner     (tenancy: sending_network_id)
--   coach                 -> NULL      (no tenancy, no seat — coaching is an
--                                       assignment, ruling 185 (2))
--
-- WHY THE SEAT IS NULLABLE. NULL is a value here, not a gap: it is what a
-- coach-only account holds. A NOT NULL column would have to invent a fifth word
-- for "none", and every reader would then have to know that word means the same
-- as absent.
--
-- ============================================================================
-- §1 — THE REPAIR, AND WHY THIS MIGRATION CANNOT SHIP WITHOUT IT
-- ============================================================================
--
-- Before this change `role` was the disambiguator: a row carrying `church_id`
-- AND `sending_network_id` was a planter because its role said so, and
-- `getAccessibleChurchIds` switched on the role before it ever looked at a
-- column. With the role gone the FK IS the answer, so a stray FK stops being
-- noise and becomes a claim — the hierarchy walk `memory/invariants.md` →
-- Multi-Tenancy forbids, arriving through the column instead of through a role.
--
-- IT ALSO BLOCKS §3 OUTRIGHT. Measured 2026-08-20 against the shared development
-- branch (41 users): 12 planter rows carry a sending_church_id AND a
-- sending_network_id copied from their plant's own org FKs. Backfilled to
-- `owner` and left alone, 13 rows (those 12 plus the real network admin) would
-- share one `sending_network_id` under `users_sending_network_owner_unique_idx`,
-- and 12 would share one `sending_church_id`. The index build fails on the first
-- duplicate and takes the whole migration with it. So this is not tidying: it is
-- what makes §3 buildable.
--
-- WHAT IS DISCARDED, NAMED. Only the oversight FKs on church-level rows. The
-- fact they duplicated is not lost — a plant's sending church and network live
-- on `churches.sending_church_id` / `churches.sending_network_id`, which is
-- where every oversight read already gets it from (`getSendingChurchPlantIds`
-- and `getNetworkChurchIds` query `churches`, never `users`). The rollback below
-- does NOT restore them, because after 0051 nothing records which rows were
-- church-level; re-deriving them from `churches` is a different statement, and
-- it is written out at the end of this header.
--
-- BOTH DIRECTIONS, AND THE MIRROR IS A NO-OP HERE. §1 has two statements: the
-- first clears the oversight FKs from CHURCH-LEVEL rows, the second clears
-- `church_id` from OVERSIGHT rows. They are the same defect either way round —
-- a row naming two tenancies — and `oversightOrgOf` resolves such a row to
-- NEITHER, so the account reaches nothing at all until it is repaired.
--
-- Measured 2026-08-20 against the shared development branch:
--
--   select role, count(*) from users
--   where role in ('sending_church_admin','network_admin') and church_id is not null
--   group by role;   -- => 0 rows
--
-- so §1b writes nothing THERE. It ships anyway, because a migration that only
-- converges on the database somebody happened to measure is not idempotent: on
-- a local, a preview or a restored dump the same query can be non-zero, and the
-- alternative was a pre-migration step in this header that an operator has to
-- read and remember. `seat_owner_uniqueness`'s census test asserts the end
-- state on whatever database it runs against — zero rows naming more than one
-- tenancy — and it is now a fact this file establishes rather than one it
-- hopes for.
--
-- COACH ROWS KEEP THEIR `church_id`, DELIBERATELY. Two seeded coaches carry one.
-- Under the seat model that reads as a plant tenancy with no seat, which is
-- exactly what a coach's access already is: `getAccessibleChurchIds` answers a
-- seatless account from `coach_assignments`, so the church set is unchanged.
-- Clearing it would move the notification feed and the nav for those accounts,
-- which is a product change and belongs to the seat-management issue, not here.
--
-- ============================================================================
-- §2 — ROLLBACK
-- ============================================================================
--
-- Roll 0051 back FIRST (it re-creates `role`), then this file, in ONE psql
-- session:
--
--   ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_seat_check";
--   DROP INDEX IF EXISTS "users_sending_network_owner_unique_idx";
--   DROP INDEX IF EXISTS "users_sending_church_owner_unique_idx";
--   DROP INDEX IF EXISTS "users_church_owner_unique_idx";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "seat";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787201056888;
--
-- Re-applying is clean from either direction: the four objects are dropped by
-- name and the backfill is a full-table UPDATE with no dependence on prior
-- state, so a rollback followed by a re-apply lands on the same rows. What a
-- rollback does NOT restore is either of §1's cleared columns — §1a's oversight
-- FKs on church-level rows, or §1b's `church_id` on oversight rows. Neither is
-- wanted back (they were the defect), and after 0051 nothing records which rows
-- were which. §1a's are re-derivable from the plant, not from this file:
--
--   UPDATE "users" u SET "sending_church_id" = c."sending_church_id",
--                        "sending_network_id" = c."sending_network_id"
--   FROM "churches" c WHERE c."id" = u."church_id" AND u."church_id" IS NOT NULL;
--
-- §1b's are not re-derivable at all: a `church_id` on an oversight row named no
-- relationship any other table records, which is why clearing it loses nothing.
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- Same reasoning as 0023-0049: the journal is the repository's list of
-- migrations, `drizzle.__drizzle_migrations` is the database's record of what
-- ran, and only the ledger row is deleted.
--
-- NO SIBLING RECONCILE OWED. `when` 1787201056888 is above every entry in the
-- journal (head was 0049 at 1786866900000), so nothing is silently skipped
-- (`memory/invariants.md` → Migrations).

ALTER TABLE "users" ADD COLUMN "seat" varchar(20);--> statement-breakpoint
-- The mapping. `coach` is the ELSE and lands NULL, which is the value it is
-- meant to hold — spelled as an explicit CASE arm rather than left to the
-- default so the file states all five names.
UPDATE "users" SET "seat" = CASE "role"
	WHEN 'planter' THEN 'owner'
	WHEN 'team_member' THEN 'member'
	WHEN 'sending_church_admin' THEN 'owner'
	WHEN 'network_admin' THEN 'owner'
	WHEN 'coach' THEN NULL
	ELSE NULL
END;--> statement-breakpoint
-- §1a. A church-level account's tenancy is its plant, so its oversight FKs are
-- cleared. Runs while `role` still exists — this is the last statement that can
-- tell a planter from a network admin, and 0051 removes the ability.
UPDATE "users"
SET "sending_church_id" = NULL,
	"sending_network_id" = NULL
WHERE "role" IN ('planter', 'team_member', 'coach')
	AND ("sending_church_id" IS NOT NULL OR "sending_network_id" IS NOT NULL);--> statement-breakpoint
-- §1b. THE MIRROR: an oversight account's tenancy is its org, so a stray
-- `church_id` is cleared. Measured 0 on the shared branch (see the header) and
-- kept regardless, so this file converges on any database rather than on the
-- one it was measured against.
UPDATE "users"
SET "church_id" = NULL
WHERE "role" IN ('sending_church_admin', 'network_admin')
	AND "church_id" IS NOT NULL;--> statement-breakpoint
-- §3. One owner per tenancy, in the database. Measured 2026-08-20 against the
-- shared development branch AFTER §1: 0 duplicate owners on all three FKs, so
-- these three builds are clean there. Any other database that is not gets a
-- constraint-violation abort naming the index, and the repair is a product
-- decision (which of the two is the owner?) that a migration must not make.
--
-- PARTIAL ON `seat = 'owner'` — Admins and Members never enter the index, and a
-- btree unique index treats NULLs as distinct, so every row with a NULL FK
-- indexes separately. A coach-only account (no tenancy, no seat) is caught by
-- neither half.
CREATE UNIQUE INDEX "users_church_owner_unique_idx" ON "users" USING btree ("church_id") WHERE "users"."seat" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "users_sending_church_owner_unique_idx" ON "users" USING btree ("sending_church_id") WHERE "users"."seat" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "users_sending_network_owner_unique_idx" ON "users" USING btree ("sending_network_id") WHERE "users"."seat" = 'owner';--> statement-breakpoint
-- The enum, in the data. A NULL seat passes: `null in (…)` is NULL and a CHECK
-- refuses only on false, which is what keeps the coach-only account writable.
ALTER TABLE "users" ADD CONSTRAINT "users_seat_check" CHECK ("users"."seat" in ('owner', 'admin', 'member'));
