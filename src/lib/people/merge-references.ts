/** Complete active reference inventory. Compared to PostgreSQL FK metadata in
 * the disposable proof. JSON event/document snapshots remain immutable. */
export const personMergeReferences = [
  { table: "person_tags", column: "person_id" },
  { table: "assessments", column: "person_id" },
  { table: "interviews", column: "person_id" },
  { table: "commitments", column: "person_id" },
  { table: "skills_inventory", column: "person_id" },
  { table: "person_activities", column: "person_id" },
  { table: "meeting_attendance", column: "person_id" },
  { table: "meeting_attendance", column: "invited_by_id" },
  { table: "meeting_responses", column: "person_id" },
  { table: "invitations", column: "inviter_id" },
  { table: "invitations", column: "invitee_id" },
  { table: "meeting_checklist_items", column: "assigned_to" },
  { table: "team_memberships", column: "person_id" },
  { table: "ministry_teams", column: "leader_id" },
  { table: "training_completions", column: "person_id" },
  { table: "communication_recipients", column: "person_id" },
  { table: "meeting_confirmation_tokens", column: "person_id" },
  { table: "tasks", column: "related_id", discriminator: "related_type" },
  { table: "notifications", column: "entity_id", discriminator: "entity_type" },
] as const;
