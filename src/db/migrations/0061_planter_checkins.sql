-- #484 (C19): the planter's own sustainability, weekly and private.
--
-- Bryan: "A plant can hit every launch metric while the planter himself is
-- falling apart." Four questions — spiritually, marriage & family, financially,
-- pace — three levels each, one optional note.
--
-- WHY IT IS ITS OWN TABLE AND NOT A `plant_signals` ROW. `plant_signals` is
-- READ BY THE FACT SNAPSHOT: every row in it becomes a fact the judge is handed
-- and a citation a network insight could carry. These four answers must be
-- structurally unreachable by that pipeline, and the cheapest way to guarantee
-- that is for them not to live in the table the pipeline reads.
--
-- NO `share_*` COLUMN AND NO OVERSIGHT FK, deliberately. Coach and org sharing
-- is a separate discovery issue (#535) with its own consent design; until that
-- ships there is nothing here to turn on by accident.
--
-- ONE ROW PER WEEK. The unique index is what makes answering idempotent — a
-- planter who changes their mind on Thursday updates Monday's row rather than
-- writing a second, contradictory one for the same week.
--
-- ORDERING. `when` is the tail (0060) plus ONE SECOND, not a day (#566): every
-- +24h hand-stamp pushes the journal further ahead of wall-clock time, so the
-- next real `Date.now()` lands below the tail. No sibling below it to reconcile
-- forward. Purely additive — a new table — so nothing existing can conflict.
CREATE TABLE "planter_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"week_start" timestamp NOT NULL,
	"spiritually" varchar(20) NOT NULL,
	"marriage_family" varchar(20) NOT NULL,
	"financially" varchar(20) NOT NULL,
	"pace" varchar(20) NOT NULL,
	"note" text,
	"answered_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "planter_checkins_levels_check" CHECK ("planter_checkins"."spiritually" in ('steady','strained','struggling')
        and "planter_checkins"."marriage_family" in ('steady','strained','struggling')
        and "planter_checkins"."financially" in ('steady','strained','struggling')
        and "planter_checkins"."pace" in ('steady','strained','struggling'))
);
--> statement-breakpoint
ALTER TABLE "planter_checkins" ADD CONSTRAINT "planter_checkins_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planter_checkins" ADD CONSTRAINT "planter_checkins_answered_by_id_users_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "planter_checkins_church_week_idx" ON "planter_checkins" USING btree ("church_id","week_start");--> statement-breakpoint
CREATE INDEX "planter_checkins_church_id_idx" ON "planter_checkins" USING btree ("church_id");
