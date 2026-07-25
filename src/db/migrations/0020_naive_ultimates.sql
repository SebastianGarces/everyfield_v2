CREATE TABLE "insight_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insight_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rubric_version" varchar(50) NOT NULL,
	"rating" varchar(20) NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phase_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"from_phase" integer NOT NULL,
	"to_phase" integer NOT NULL,
	"initiated_by_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"fact_snapshot" jsonb,
	"rubric_version" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plant_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"phase" integer NOT NULL,
	"rubric_version" varchar(50) NOT NULL,
	"fact_snapshot" jsonb NOT NULL,
	"model_id" varchar(100),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plant_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"audience" varchar(20) NOT NULL,
	"category" varchar(100) NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"title" varchar(500) NOT NULL,
	"body" text NOT NULL,
	"cited_facts" jsonb,
	"related_article_slugs" text[],
	"rank" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plant_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"signal_key" varchar(100) NOT NULL,
	"value" jsonb NOT NULL,
	"attested_by_id" uuid NOT NULL,
	"attested_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "churches" ADD COLUMN "launch_date" date;--> statement-breakpoint
ALTER TABLE "churches" ADD COLUMN "last_material_event_at" timestamp;--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_insight_id_plant_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."plant_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_assessment_id_plant_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."plant_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_transitions" ADD CONSTRAINT "phase_transitions_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_transitions" ADD CONSTRAINT "phase_transitions_initiated_by_id_users_id_fk" FOREIGN KEY ("initiated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_assessments" ADD CONSTRAINT "plant_assessments_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_insights" ADD CONSTRAINT "plant_insights_assessment_id_plant_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."plant_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_insights" ADD CONSTRAINT "plant_insights_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_signals" ADD CONSTRAINT "plant_signals_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_signals" ADD CONSTRAINT "plant_signals_attested_by_id_users_id_fk" FOREIGN KEY ("attested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insight_feedback_insight_user_idx" ON "insight_feedback" USING btree ("insight_id","user_id");--> statement-breakpoint
CREATE INDEX "insight_feedback_insight_id_idx" ON "insight_feedback" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "insight_feedback_assessment_id_idx" ON "insight_feedback" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "insight_feedback_church_id_idx" ON "insight_feedback" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "insight_feedback_rubric_version_idx" ON "insight_feedback" USING btree ("rubric_version");--> statement-breakpoint
CREATE INDEX "phase_transitions_church_id_idx" ON "phase_transitions" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "phase_transitions_church_created_idx" ON "phase_transitions" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE INDEX "phase_transitions_initiated_by_idx" ON "phase_transitions" USING btree ("initiated_by_id");--> statement-breakpoint
CREATE INDEX "plant_assessments_church_id_idx" ON "plant_assessments" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "plant_assessments_church_generated_idx" ON "plant_assessments" USING btree ("church_id","generated_at");--> statement-breakpoint
CREATE INDEX "plant_assessments_status_idx" ON "plant_assessments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "plant_insights_assessment_id_idx" ON "plant_insights" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "plant_insights_church_id_idx" ON "plant_insights" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "plant_insights_audience_idx" ON "plant_insights" USING btree ("audience");--> statement-breakpoint
CREATE INDEX "plant_insights_assessment_audience_idx" ON "plant_insights" USING btree ("assessment_id","audience");--> statement-breakpoint
CREATE UNIQUE INDEX "plant_signals_church_key_idx" ON "plant_signals" USING btree ("church_id","signal_key");--> statement-breakpoint
CREATE INDEX "plant_signals_church_id_idx" ON "plant_signals" USING btree ("church_id");