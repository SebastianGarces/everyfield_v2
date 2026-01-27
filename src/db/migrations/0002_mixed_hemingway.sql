CREATE TABLE "wiki_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_slug" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"scroll_position" real DEFAULT 0,
	"last_viewed_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_progress" ADD CONSTRAINT "wiki_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_progress_user_article_idx" ON "wiki_progress" USING btree ("user_id","article_slug");--> statement-breakpoint
CREATE INDEX "wiki_progress_user_idx" ON "wiki_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wiki_progress_last_viewed_idx" ON "wiki_progress" USING btree ("user_id","last_viewed_at");