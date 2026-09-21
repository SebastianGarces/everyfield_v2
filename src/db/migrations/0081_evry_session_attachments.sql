CREATE TABLE "evry_eve_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"church_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reference_hash" text NOT NULL,
	"reference" text NOT NULL,
	"kind" text NOT NULL,
	"digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_eve_attachments_kind_check" CHECK ("evry_eve_attachments"."kind" in ('people_csv', 'person_photo', 'commitment_document')),
	CONSTRAINT "evry_eve_attachments_hash_check" CHECK ("evry_eve_attachments"."digest" ~ '^[a-f0-9]{64}$' and "evry_eve_attachments"."reference_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "evry_eve_attachments" ADD CONSTRAINT "evry_eve_attachments_session_id_evry_eve_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."evry_eve_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_eve_attachments" ADD CONSTRAINT "evry_eve_attachments_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_eve_attachments" ADD CONSTRAINT "evry_eve_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evry_eve_attachments_session_reference_idx" ON "evry_eve_attachments" USING btree ("session_id","reference_hash");