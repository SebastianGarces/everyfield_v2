-- #616 (CS-002): the address an account has ASKED for, before it is the address
-- it signs in with.
--
-- `users.email` IS the login identifier, so it may only ever hold an address
-- somebody has PROVEN they can read. This table holds the proof in flight: the
-- address asked for, and the sha256 of a 32-byte token that exists only in the
-- email sent to it. A database read, a log line or a backup therefore hands
-- nobody a working link -- the same rule `user_invitations.token_hash` carries.
--
-- TWO UNIQUE INDEXES, TWO DIFFERENT JOBS.
--   * `token_hash` -- the redemption is a point read on the digest, and two rows
--     can never carry one token.
--   * `user_id WHERE consumed_at IS NULL` -- AT MOST ONE LIVE REQUEST PER
--     ACCOUNT. Asking again supersedes rather than accumulating, and the
--     supersede must therefore run BEFORE the insert in the same batch, or the
--     index refuses it. That is what makes a mistyped address self-correcting
--     with no Cancel control to build.
--
-- EXPIRY IS NOT IN THE INDEX AND CANNOT BE: `now()` is not immutable, so a
-- partial index may not name it. The window is enforced in the redemption's own
-- WHERE; an expired-but-unconsumed row still holds the live slot, which is the
-- honest reading -- that account HAS an outstanding request and has simply run
-- out of time to answer it.
--
-- ON DELETE CASCADE: a pending address change for an account that no longer
-- exists is a token pointing at nothing.
--
-- ORDERING. `when` is the tail (0062) plus ONE SECOND, not a day (#566). No
-- sibling below it to reconcile forward. Purely additive -- a new table -- so
-- nothing existing can conflict, and rolling it back is DROP TABLE
-- "email_change_requests" with no data loss outside its own rows.
--
-- RENUMBERED FROM 0062, and this is the reconcile the rule demands. #642
-- (church street address) merged first and took 0062, so this DDL was
-- regenerated on top of it rather than renamed -- the snapshot chain now builds
-- on #642's schema, which a rename alone would not have done.
--
--   DETECT: select 1 from drizzle.__drizzle_migrations
--           where created_at = 1787552243967;
--           -- 1787552243967 is 0062. If the row present at that stamp created
--           -- `email_change_requests` rather than `churches.street_address`,
--           -- that database applied the OLD number of THIS migration.
--   IF SO:  update drizzle.__drizzle_migrations
--             set created_at = 1787552244967 where created_at = 1787552243967;
--           -- then apply 0062 (church street address), which that database is
--           -- missing.
--   IF NOT: nothing to do -- apply normally.
--
-- Expected to be a no-op everywhere: the old number existed only on this
-- branch, and the only databases that ever applied it are the per-suite
-- throwaways the CI live lane builds from zero on each run.
CREATE TABLE "email_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"new_email" varchar(255) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_change_requests_token_hash_unique_idx" ON "email_change_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "email_change_requests_live_user_unique_idx" ON "email_change_requests" USING btree ("user_id") WHERE "email_change_requests"."consumed_at" is null;