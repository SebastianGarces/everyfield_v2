# Database Contracts

ORM: Drizzle | DB: PostgreSQL (Neon serverless) | **Connection:** `src/db/index.ts`

37 tables across `src/db/schema/*.ts` (file names cited per table below). Notation — unless stated: `id` uuid PK auto; `church_id` → churches required (tenant scope); `created_at`/`updated_at` timestamps default now; `created_by`/`created_by_id` → users required. `→t` = uuid FK to table t; `(c)` = cascade delete; `=x` = default; untyped columns are varchar/text (lengths in source).

## Hierarchy

**sending_networks** (`sending-network.ts`): name req.

**sending_churches** (`sending-church.ts`): name req; sending_network_id →sending_networks null.

## Core

**churches** (`church.ts`) — multi-tenant root: name req; current_phase int =0; sending_church_id / sending_network_id FK null; inactivity_warning_days int =7; inactivity_alert_days int =14; launch_date date null (Phase Engine countdown); last_material_event_at timestamp null (Phase Engine "dirty" marker).

**users** (`user.ts`): email unique req; password_hash Argon2id; name null; role: planter/coach/team_member/sending_church_admin/network_admin; church_id / sending_church_id / sending_network_id FK null.

**sessions** (`session.ts`): id varchar PK = SHA-256 of token; user_id →users(c); expires_at + created_at timestamptz; ip_address; user_agent; country; city; fresh bool =true.

**auth_attempts** (`auth-attempts.ts`) — login/register rate limiting, NOT church-scoped: identifier req (lowercased email); ip null; kind: login/register; success bool. Indexed by (identifier|ip, kind, created_at).

**feedback** (`feedback.ts`): church_id FK NULL; user_id →users req; category: bug/suggestion/question/other =suggestion; description req; page_url; status: new/reviewed/resolved/dismissed =new.

## Wiki (`wiki.ts`)

**wiki_sections** — hierarchical nav: slug unique; name; description/icon null; parent_section_id FK self; phase int 0-6 null; sort_order int =0.

**wiki_articles**: church_id FK NULL (null = global); slug unique per church; title; content (raw MDX); excerpt null; content_type: tutorial/how_to/explanation/reference/overview/guide; phase int 0-6 null; section_id →wiki_sections; read_time_minutes int; sort_order int =999; related_article_slugs text[]; status: draft/published/archived; published_at. FTS gin index.

**wiki_progress**: user_id →users(c); article_slug (links by slug); status: not_started/in_progress/completed; scroll_position real 0-1; last_viewed_at; completed_at null. Unique (user_id, article_slug).

**wiki_bookmarks**: user_id →users(c); article_slug. Unique (user_id, article_slug).

## People / CRM (`people.ts`)

**persons** — main CRM records: first_name + last_name req; email/phone null; address_* (line1, line2, city, state, postal_code, country); status =prospect; source; source_details + notes; photo_url; household_id →households; household_role: head/spouse/child/other; pipeline_sort_order int =0; created_by; deleted_at soft delete.
Status enum (7): prospect, attendee, following_up, interviewed, core_group, launch_team, leader.
Source enum: personal_referral, social_media, vision_meeting, website, event, partner_church, other.

**households** — family groupings: name req; address_*.

**tags**: name req; color hex. No updated_at.

**person_tags** — junction: person_id + tag_id FK(c). Unique (person_id, tag_id).

**assessments** — 4 C's: person_id →persons(c); assessed_by →users; committed/compelled/contagious/courageous_score int 1-5; total_score int 4-20 calculated; *_notes; assessment_date date.

**interviews** — 5-criteria: person_id →persons(c); interviewed_by →users; interview_date date; maturity/gifted/chemistry/right_reasons/season_status: pass/fail/concern; *_notes; overall_result: qualified/qualified_with_notes/not_qualified/follow_up; next_steps.

**commitments**: person_id →persons(c); commitment_type: core_group/launch_team; signed_date date req; witnessed_by →users; document_url; notes.

**skills_inventory**: person_id →persons(c); skill_category: worship/tech/admin/teaching/hospitality/leadership/other; skill_name req; proficiency: beginner/intermediate/advanced/expert; notes.

**person_activities** — timeline: person_id →persons(c); activity_type; metadata jsonb; performed_by →users.
Activity types (16): status_changed, note_added, person_created, person_updated, interview_completed, assessment_completed, commitment_recorded, tag_added, tag_removed, skill_added, skill_updated, skill_removed, household_created, household_joined, household_left, household_role_changed.

## Access Control

**coach_assignments** (`coach-assignment.ts`): coach_user_id →users req; church_id req; assigned_at; status: active/inactive =active. Unique (coach_user_id, church_id).

**organization_invitations** (`organization-invitation.ts`): type: church_to_sending_church/sending_church_to_network/church_to_network; inviter_user_id →users req; target_church_id / target_sending_church_id / sending_church_id / sending_network_id FK null; status: pending/accepted/declined/expired/revoked; responded_by FK null; responded_at + expires_at null.

**church_privacy_settings** (`church-privacy-settings.ts`) — per-feature oversight toggles: church_id unique; share_people / share_meetings / share_tasks / share_financials / share_ministry_teams / share_facilities bool =false; updated_by FK null.

## Meetings (`meetings.ts`)

Unified meetings model (replaced the old vision-meetings schema).

**locations** — venues, shared across meeting types: name req; address req; contact_name/phone/email null; cost; capacity int null; notes; is_active bool =true.

**church_meetings** — unified meeting entity: type req: vision_meeting/orientation/team_meeting; title null; datetime req; status: planning/ready/in_progress/completed/cancelled =planning; location_id FK null + location_name/address snapshot; meeting_number int NULL (vision-meeting specific); team_id →ministry_teams null + meeting_subtype: regular/training/planning/special/rehearsal (team-meeting specific); estimated_attendance / actual_attendance / duration_minutes int null; notes; agenda jsonb; created_by. Unique (church_id, meeting_number).

**meeting_attendance**: meeting_id →church_meetings(c); person_id →persons(c); attendance_type null: first_time/returning/core_group; status: attended/absent/excused =attended; invited_by_id →persons null; response_status null: confirmed/declined/interested/ready_commit/questions/not_interested; notes; created_by →users null. Unique (meeting_id, person_id).

**invitations** — who invited whom (vision-meeting focused): meeting_id →church_meetings(c); inviter_id →persons req; invitee_name null; invitee_id →persons null; status: invited/confirmed/maybe/declined/attended/no_show =invited.

**meeting_evaluations** — 8 quality-factor scores: meeting_id →church_meetings(c) unique (one per meeting); attendance/location/logistics/agenda/vibe/message/close/next_steps_score int 1-5 req; total_score varchar average; notes; evaluated_by →users req.

**meeting_checklist_items**: meeting_id →church_meetings(c); item_name req; category: essential/materials/setup/av/organization; is_checked bool =false; notes; assigned_to →persons null.

## Tasks (`tasks.ts`)

**tasks**: title req; description; status: not_started/in_progress/blocked/complete =not_started; priority: low/medium/high/urgent =medium; due_date date + due_time time null; assigned_to_id →users null; category: vision_meeting/follow_up/training/facilities/promotion/administrative/ministry_team/launch_prep/recurring/general; related_type: person/meeting/team/facility + related_id uuid; parent_task_id uuid; is_recurring bool =false + recurrence_rule jsonb; completion_event (auto-complete hook); completed_at + completed_by_id null; created_by_id; deleted_at soft delete. **Partial unique index** `tasks_meeting_evaluation_unique_idx` on (church_id, related_id) WHERE completion_event='meeting.evaluation.completed' AND deleted_at IS NULL — one live evaluation task per meeting; this is what makes follow-up generation idempotent under concurrency (see invariants → Transactions / Atomicity).

## Communication (`communication.ts`)

**message_templates**: church_id FK NULL (null = system template); name req; description; category: meeting_invitation/meeting_reminder/follow_up/core_group/team/announcement/launch/other; channel: email/sms/both =email; subject; body req + body_html; merge_fields jsonb string[]; is_system bool =false; source_template_id uuid (fork origin).

**communications** — main message records: subject; body req + body_html; channel =email; template_id →message_templates null; meeting_id →church_meetings null; status: draft/scheduled/sending/sent/failed =draft; scheduled_at / sent_at null; recipient_count int; created_by_id.

**communication_recipients** — per-recipient delivery tracking (updated by Resend webhook): communication_id FK(c); person_id →persons(c); email / phone; channel =email; status: pending/sent/delivered/opened/clicked/bounced/failed =pending (forward-only); delivered_at/opened_at/clicked_at; external_id (Resend email id); error_message. No created_at/updated_at.

**meeting_confirmation_tokens** — token RSVP (`/api/rsvp/[token]`): token unique req; meeting_id →church_meetings(c); person_id →persons(c); status: pending/confirmed/declined =pending; responded_at null; expires_at req. No updated_at.

## Ministry Teams (`ministry-teams.ts`)

**ministry_teams**: name req; type: predefined/custom =predefined; description; icon; leader_id →persons null; reports_to_team_id uuid; phase_introduced: phase_0..phase_6 =phase_2; status: forming/active/paused =forming; sort_order int =0; created_by.

**team_roles**: team_id →ministry_teams(c); name req; description; reports_to_role_id uuid; is_leadership_role bool =false; time_commitment: low/medium/high; desired_skills; sort_order int =0; status: open/filled =open; created_by.

**team_memberships**: team_id FK(c); person_id →persons(c); role_id →team_roles(c); start_date/end_date date null; status: active/inactive/pending =active; notes; created_by. Partial unique (team_id, person_id, role_id) WHERE status='active' — allows re-assignment after inactive.

**training_programs**: team_id →ministry_teams set-null; name req; description; is_required bool =false; created_by.

**training_completions**: person_id →persons(c); training_program_id FK(c); completed_at req; verified_by →users null; notes; created_by. Unique (person_id, training_program_id).

## Phase Engine (`phase-engine.ts`)

Facts are computed at assessment time — only manual attestations persist (plant_signals). Judge runs persist as immutable snapshots (plant_assessments + plant_insights); UI reads the latest, never a live LLM call. All church_id-scoped.

**phase_transitions** — append-only audit log, soft-gated (forward/backward/skip, never blocked): from_phase + to_phase int req; initiated_by_id →users req; reason req; fact_snapshot jsonb; rubric_version req. No updated_at.

**plant_signals** — manual self-attestations only: signal_key req; value jsonb req; attested_by_id →users req; attested_at =now. Unique (church_id, signal_key) — upserted.

**plant_assessments** — one LLM-judge snapshot; latest `complete` row per church drives all reads: generated_at =now; phase int req; rubric_version req; fact_snapshot jsonb req; model_id null; status: pending/complete/failed =pending. No updated_at.

**plant_insights** — one finding within an assessment: assessment_id FK(c); audience: planter/network (privacy-gated); category; severity: info/low/medium/high/critical =info; title; body; cited_facts jsonb; related_article_slugs text[]; rank int =0. No updated_at.

**insight_feedback** — per-insight rating (rubric-tuning signal): insight_id + assessment_id FK(c); user_id →users req; rubric_version req (denormalized); rating: useful/not_useful; comment. Unique (insight_id, user_id) — upserted.

## Notifications (`notifications.ts`)

F11 foundation. Categories/channels/statuses are code-defined tuples in the schema file, re-exported with their coded defaults by `src/lib/notifications/categories.ts`. Enqueue contract: `src/lib/notifications/enqueue.ts` (`enqueue`, `cancelByEntity` — never calls a provider); reads: `queries.ts` (every builder takes a `NotificationScope` whose `churchId` is required); preference resolution: `preferences.ts`.

**notifications** — the queue row AND the in-app feed row, one record: recipient_user_id →users(c) req; category: tasks/meetings/communication/teams/phase/digest; type req (caller discriminator, e.g. `task.overdue`); title + body req (rendered by the caller — F11 never templates); entity_type + entity_id null (cancel-by-entity target + feed link); dedupe_key null; scheduled_for =now; status: pending/claimed/delivered/cancelled/failed =pending; read_at null (independent of delivery). **Partial unique index** `notifications_dedupe_key_unique_idx` on (church_id, dedupe_key) WHERE dedupe_key IS NOT NULL — the arbiter for `ON CONFLICT DO NOTHING`, which is what makes enqueue idempotent under concurrency (see invariants → Transactions / Atomicity). Also indexed for the feed (church_id, recipient_user_id, created_at), unread (partial, read_at IS NULL), dispatch (status, scheduled_for), entity (church_id, entity_type, entity_id).

**notification_preferences** — per (user, category, channel); **NOT church-scoped** (a coach across two churches has one set), the one notification table with no church_id: user_id →users(c) req; category; channel: email/in_app; enabled bool =true; digest_cadence: daily/weekly null (only meaningful on `digest`). Unique (user_id, category, channel) — upserted. **An ABSENT row means the category's coded default, not "off"** — rows are never seeded, so a new category needs no backfill.

**notification_deliveries** — one row per channel attempt: notification_id FK(c); channel; status: queued/sent/failed/suppressed_by_preference/cancelled =queued; attempt_count int =0; error null; provider_message_id null (webhook correlation); sent_at null. Unique (notification_id, channel) — this is what makes at-most-once delivery a DB guarantee rather than a dispatcher intention.

## Methodology RAG (`methodology-embeddings.ts`)

**methodology_embeddings** — GLOBAL corpus, intentionally NOT church-scoped: source: wiki/playbook; doc_key req (wiki slug or "playbook:<section>"); article_slug null; phase int 0-6 null; section; chunk_index int req; content req; embedding vector(1536) req (text-embedding-3-small). Unique (doc_key, chunk_index) for idempotent re-embed; HNSW cosine index.
