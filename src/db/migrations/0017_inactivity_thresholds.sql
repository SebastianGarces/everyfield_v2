ALTER TABLE "churches" ADD COLUMN "inactivity_warning_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "churches" ADD COLUMN "inactivity_alert_days" integer DEFAULT 14 NOT NULL;