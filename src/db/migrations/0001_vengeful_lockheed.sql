CREATE TABLE "wiki_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"excerpt" text,
	"content_type" text NOT NULL,
	"phase" integer,
	"section_id" uuid,
	"read_time_minutes" integer,
	"sort_order" integer DEFAULT 999 NOT NULL,
	"related_article_slugs" text[],
	"status" text DEFAULT 'published' NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"parent_section_id" uuid,
	"phase" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_articles" ADD CONSTRAINT "wiki_articles_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_articles" ADD CONSTRAINT "wiki_articles_section_id_wiki_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."wiki_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_sections" ADD CONSTRAINT "wiki_sections_parent_section_id_wiki_sections_id_fk" FOREIGN KEY ("parent_section_id") REFERENCES "public"."wiki_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_articles_slug_church_idx" ON "wiki_articles" USING btree ("slug","church_id");--> statement-breakpoint
CREATE INDEX "wiki_articles_status_idx" ON "wiki_articles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "wiki_articles_section_idx" ON "wiki_articles" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "wiki_articles_phase_idx" ON "wiki_articles" USING btree ("phase");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_sections_slug_idx" ON "wiki_sections" USING btree ("slug");