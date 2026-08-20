-- ministry_teams.template_key, the "Leadership" rename, and the one-time
-- leadership reconcile (#378 WS2 + WS3; ruled 2026-08-09 and 2026-08-12).
--
-- ONE FILE, THREE STEPS, IN THE ONLY ORDER THAT WORKS: the key has to exist and
-- be backfilled before the rename, because the rename is what makes the NAME
-- unusable as an identity; and the reconcile keys off the same column. Splitting
-- them would ship a window in which "Senior Pastor" is renamed and nothing can
-- find the team it used to name. It reads `persons.user_id` from 0052, so that
-- file must apply first — its `when` is lower, which is what enforces it.
--
-- ============================================================================
-- §1 — WHY A KEY AT ALL (ruling 2026-08-12, sweep #403 / PR #409 DECISION 2)
-- ============================================================================
--
-- A predefined team's DISPLAY NAME was its identity in four places: the
-- org-chart root, the responsibilities lookup, the name→template map behind the
-- role import, and `teamRequiresBackgroundCheck`. Renaming the template would
-- have silently broken all four for every plant that already had teams — and
-- the fourth was already broken for any planter who renamed their own
-- Children's Ministry team, which dropped the roster's background-check column
-- with nothing said. The key is the identity now; `name` is display.
--
-- NULLABLE, because a CUSTOM team came from no template. It stays NULL for
-- them, and every lookup answers "not a template team", which is the same
-- answer they got before.
--
-- ============================================================================
-- §2 — THE BACKFILL, AND WHAT IT DELIBERATELY LEAVES NULL
-- ============================================================================
--
-- Measured 2026-08-20 against the shared development branch, read-only:
-- 92 predefined teams and 10 custom ones. Keyed by exact name, 66 predefined
-- teams match a current template:
--
--   Worship Team 14, Children's Ministry 13, Small Groups 11,
--   Assimilation 4, Facilities 4, Launch Coordinator 4, Prayer 4,
--   Promotion 4, Senior Pastor 4, Technology 4
--
-- and 26 do NOT, because they carry names from an earlier template list:
--
--   Assimilation & Welcome 8, Admin & Finance 6, Facilities & Setup 5,
--   Promotion & Outreach 4, Technology & AV 3
--
-- THOSE 26 ARE LEFT NULL ON PURPOSE. Four of the five names resemble a current
-- template ("Facilities & Setup" ≈ facilities) and the fifth, Admin & Finance,
-- corresponds to no key that exists — so an alias table here would be a guess
-- written into data, and a wrong guess is invisible afterwards. Leaving them
-- NULL is not a regression either: their names match no template TODAY, so
-- every one of the four lookups already answers "not a template team" for them.
-- Naming them is a product decision with a ruling behind it, not a migration's.
--
-- MATCHED BY THE PRE-RENAME NAME. §2 runs before §3, so `senior_pastor` is
-- claimed off "Senior Pastor" — the name those four rows still carry. Reversing
-- the two statements keys nothing and renames nothing.
--
-- ============================================================================
-- §3 — THE RENAME (ruled 2026-08-09)
-- ============================================================================
--
-- A TEAM carries a ministry's name and a ROLE carries a person's, and this was
-- the one template that named the team after the role inside it. "Senior
-- Pastor" the team becomes "Leadership"; the `senior_pastor` key and both role
-- names ("Senior Pastor", "Associate Pastor") are unchanged.
--
-- Measured: 4 rows to rename, and 0 plants already hold a predefined team named
-- "Leadership". The `NOT EXISTS` guard ships anyway, because
-- `ministry_teams_predefined_name_unique_idx` (migration 0034) is a UNIQUE index
-- on (church_id, name) WHERE type = 'predefined': on a database where some plant
-- has both, an unguarded rename aborts the whole migration on a duplicate key.
-- Guarded, that plant keeps its "Senior Pastor" row — visibly wrong and
-- repairable — instead of blocking everyone else's migration.
--
-- CUSTOM TEAMS ARE UNTOUCHED, and the predicate that says so is
-- `template_key = 'senior_pastor'`, not `type = 'predefined'`: a planter's own
-- team called "Senior Pastor" carries no key and is not ours to rename.
--
-- ============================================================================
-- §4 — THE ONE-TIME LEADERSHIP RECONCILE (#378 WS2, ruled 2026-08-09)
-- ============================================================================
--
-- Onboarding asks "will you be the lead pastor?" and stores the answer on
-- `churches.leadership_status`. From now on `importRoleTemplates` applies it
-- when the templates land (`src/lib/ministry-teams/leadership-fill.ts`), but
-- plants that initialized their teams BEFORE this change already have the role
-- and it is sitting open. §4 fills those once.
--
-- Measured 2026-08-20: 7 plants read `planter_confirmed` (71 unanswered, 0
-- `no_planter`), and 4 of them hold an OPEN "Senior Pastor" role on the
-- template team — so §4 writes 4 memberships there. It also depends on 0052
-- having minted those plants' Owner person rows, which it did.
--
-- A FILLED ROLE IS NEVER OVERWRITTEN. `r."status" = 'open'` plus `NOT EXISTS`
-- an active membership on the role are both stated: the status column is what
-- the product shows and the membership is what is true, and a row where they
-- disagree must not be repaired by seating somebody over a real person.
--
-- AND THIS FILE REPAIRS NOTHING IT DID NOT CAUSE. §4 is ONE statement with a
-- data-modifying CTE: the INSERT returns the role ids it wrote and the UPDATE
-- joins them, so the flip to `filled` reaches exactly those rows. The earlier
-- shape — a second statement matching open roles that have an active member —
-- was wider than the rule it was written for: a plant whose Senior Pastor role
-- already read `open` while somebody sat in it (however that arose) would have
-- been quietly corrected by a migration whose header said it only seated
-- planters. A repair nobody asked for and nobody can find afterwards is worse
-- than the disagreement it fixes.
--
-- `no_planter` AND UNANSWERED PLANTS GET NOTHING, which is the ruling: the role
-- stays open and whoever leads the plant fills it by hand.
--
-- DISTINCT ON (r."team_id") — one seat per team, deterministically. A plant
-- that imported the same templates twice has two open "Senior Pastor" rows (the
-- import carries no ON CONFLICT), and inside ONE `INSERT … SELECT` the
-- `NOT EXISTS` guards read the pre-statement snapshot, so both would be filled
-- and the team would show two Senior Pastors. Oldest role wins.
--
-- WHY THIS IS SQL AND NOT `assignMember`. A migration cannot call the service,
-- and this is the ONE exception to "the auto-fill goes through the assignment
-- path": a one-shot repair of rows that predate the feature. The live path is
-- `fillLeadershipRole` and it does go through `assignMember`. What §4 forgoes is
-- the two domain events, and neither has anything to do here — `autoAdvance
-- Status` moves a person only from an exact `from`, and 0052 minted these
-- people at `leader`, which is above both hops.
--
-- ============================================================================
-- §5 — ROLLBACK
-- ============================================================================
--
--   -- §4, by the shape it wrote:
--   UPDATE "team_roles" r SET "status" = 'open'
--     FROM "team_memberships" m, "ministry_teams" t, "persons" p
--    WHERE m."role_id" = r."id" AND m."status" = 'active'
--      AND t."id" = r."team_id" AND t."template_key" = 'senior_pastor'
--      AND p."id" = m."person_id" AND p."user_id" IS NOT NULL;
--   DELETE FROM "team_memberships" m USING "ministry_teams" t, "persons" p
--    WHERE t."id" = m."team_id" AND t."template_key" = 'senior_pastor'
--      AND p."id" = m."person_id" AND p."user_id" IS NOT NULL;
--   -- §3:
--   UPDATE "ministry_teams" SET "name" = 'Senior Pastor'
--    WHERE "template_key" = 'senior_pastor' AND "name" = 'Leadership';
--   -- §2 and §1:
--   ALTER TABLE "ministry_teams" DROP COLUMN IF EXISTS "template_key";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787227890551;
--
-- The §4 rollback deletes any membership on a senior_pastor team held by a
-- LINKED person, which on a database where a planter also assigned themselves
-- by hand removes that assignment too — §4 records nothing that tells the two
-- apart. Re-applying is clean from either direction: §2 and §4 are both
-- `NOT EXISTS`-guarded and §3 matches only the pre-rename name.
--
--   *** DO NOT EDIT src/db/migrations/meta/_journal.json. ***
--
-- NO SIBLING RECONCILE OWED. `when` 1787227890551 is above every entry in the
-- journal — head was 0052 at 1787227880551, this file's own predecessor — so
-- nothing is silently skipped (`memory/invariants.md` → Migrations).

ALTER TABLE "ministry_teams" ADD COLUMN "template_key" varchar(50);--> statement-breakpoint
-- §2. The identity, claimed off the name the row carries TODAY — before §3
-- changes one of those names. Exact match only; the five legacy names are
-- listed in the header and stay NULL.
UPDATE "ministry_teams" t
SET "template_key" = v."key"
FROM (VALUES
	('Senior Pastor', 'senior_pastor'),
	('Launch Coordinator', 'launch_coordinator'),
	('Worship Team', 'worship'),
	('Children''s Ministry', 'childrens_ministry'),
	('Facilities', 'facilities'),
	('Assimilation', 'assimilation'),
	('Small Groups', 'small_groups'),
	('Promotion', 'promotion'),
	('Prayer', 'prayer'),
	('Technology', 'technology')
) AS v("name", "key")
WHERE t."type" = 'predefined'
	AND t."template_key" IS NULL
	AND t."name" = v."name";--> statement-breakpoint
-- §3. The rename. Guarded against `ministry_teams_predefined_name_unique_idx`
-- (see the header) — measured 0 collisions on the shared branch.
UPDATE "ministry_teams" t
SET "name" = 'Leadership',
	"updated_at" = now()
WHERE t."template_key" = 'senior_pastor'
	AND t."name" = 'Senior Pastor'
	AND NOT EXISTS (
		SELECT 1 FROM "ministry_teams" o
		WHERE o."church_id" = t."church_id"
			AND o."type" = 'predefined'
			AND o."name" = 'Leadership'
	);--> statement-breakpoint
-- §4. Seat the confirmed planter, and flip exactly the roles that seated one.
--
-- ONE STATEMENT, and the CTE is what makes the second half provable: `seated`
-- RETURNS the role ids the INSERT actually wrote, and the UPDATE joins them. A
-- separate §4b matching "an open Senior Pastor role on a senior_pastor team
-- with an active membership held by a linked person" would have been WIDER than
-- its own comment claimed — it would also have repaired a pre-existing
-- open-role-with-a-member disagreement this file knows nothing about, silently
-- and with no record of having done it.
WITH "seated" AS (
	INSERT INTO "team_memberships" ("church_id", "team_id", "person_id", "role_id", "status", "created_by")
	SELECT DISTINCT ON (r."team_id")
		r."church_id", r."team_id", p."id", r."id", 'active', p."user_id"
	FROM "team_roles" r
	JOIN "ministry_teams" t
		ON t."id" = r."team_id" AND t."template_key" = 'senior_pastor'
	JOIN "churches" c
		ON c."id" = r."church_id" AND c."leadership_status" = 'planter_confirmed'
	JOIN "users" u
		ON u."church_id" = r."church_id" AND u."seat" = 'owner'
	JOIN "persons" p
		ON p."user_id" = u."id" AND p."church_id" = r."church_id" AND p."deleted_at" IS NULL
	WHERE r."name" = 'Senior Pastor'
		AND r."status" = 'open'
		AND NOT EXISTS (
			SELECT 1 FROM "team_memberships" m
			WHERE m."role_id" = r."id" AND m."status" = 'active'
		)
		AND NOT EXISTS (
			SELECT 1 FROM "team_memberships" m
			WHERE m."team_id" = r."team_id" AND m."person_id" = p."id" AND m."status" = 'active'
		)
	ORDER BY r."team_id", r."created_at", r."id"
	RETURNING "role_id"
)
UPDATE "team_roles" r
SET "status" = 'filled',
	"updated_at" = now()
FROM "seated" s
WHERE r."id" = s."role_id";
