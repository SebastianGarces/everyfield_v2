CREATE TABLE "evry_eve_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "evry_eve_sessions_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "evry_eve_sessions" ADD CONSTRAINT "evry_eve_sessions_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_eve_sessions" ADD CONSTRAINT "evry_eve_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evry_eve_sessions_owner_idx" ON "evry_eve_sessions" USING btree ("church_id","user_id","updated_at");