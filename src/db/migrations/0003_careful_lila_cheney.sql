CREATE TABLE "wiki_bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_bookmarks" ADD CONSTRAINT "wiki_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_bookmarks_user_article_idx" ON "wiki_bookmarks" USING btree ("user_id","article_slug");--> statement-breakpoint
CREATE INDEX "wiki_bookmarks_user_idx" ON "wiki_bookmarks" USING btree ("user_id");