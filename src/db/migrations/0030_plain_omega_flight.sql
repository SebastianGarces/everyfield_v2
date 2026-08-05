ALTER TABLE "organization_invitations" ADD COLUMN "invitee_email" varchar(255);--> statement-breakpoint
CREATE INDEX "org_invitations_sending_church_id_idx" ON "organization_invitations" USING btree ("sending_church_id");--> statement-breakpoint
CREATE INDEX "org_invitations_sending_network_id_idx" ON "organization_invitations" USING btree ("sending_network_id");