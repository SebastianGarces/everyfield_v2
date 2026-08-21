-- #448 (N-013, ruled 2026-08-15): the planter digest's send time is a CHURCH
-- setting, defaulting to Sunday 16:00 in the church's own `time_zone`.
--
-- ORDERING. Generated at 0056, rebased to 0058 after `0056_insight_category_
-- cohesion` and `0057_feedback_github_issue_number` landed on main first. Purely
-- additive: two new columns on `churches` and their two constraints. It touches
-- no table either of those does, so the reorder is a renumbering and nothing
-- more (`memory/invariants.md` → Migrations, on why `idx` does not reserve an
-- order). Nothing is dropped and no existing column changes type, so it rolls
-- back by dropping what it added.
--
-- THE BACKFILL IS THE DEFAULT. `ADD COLUMN ... DEFAULT ... NOT NULL` fills every
-- existing row with the ruled default in the same statement, so there is no
-- separate UPDATE to get wrong and no window in which a church holds NULL. Every
-- church that predates this column is therefore Sunday 16:00 local, which is
-- exactly the ruling, and a planter who wants another time changes it in church
-- settings.
--
-- WHY THESE TWO GET CHECKS WHEN `time_zone` DOES NOT. IANA's zone list drifts —
-- zones are added and renamed — so a CHECK over it would freeze the runtime's
-- own list into the schema, and `isValidTimeZone` asks `Intl` on the write path
-- instead. 0–6 and 0–23 are arithmetic and never drift. The failure they stop is
-- worth the constraint: an hour of 24 is a wall clock that never comes round, so
-- the period it anchors never opens and the recipient is owed a digest forever
-- with nothing in any log to say why.

ALTER TABLE "churches" ADD COLUMN "digest_send_weekday" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "churches" ADD COLUMN "digest_send_hour" integer DEFAULT 16 NOT NULL;--> statement-breakpoint
ALTER TABLE "churches" ADD CONSTRAINT "churches_digest_send_weekday_check" CHECK ("churches"."digest_send_weekday" between 0 and 6);--> statement-breakpoint
ALTER TABLE "churches" ADD CONSTRAINT "churches_digest_send_hour_check" CHECK ("churches"."digest_send_hour" between 0 and 23);
