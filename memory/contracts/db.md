# Database Contracts

ORM: Drizzle | DB: PostgreSQL (Neon serverless)

**Connection:** `src/db/index.ts`

## Hierarchy Tables

### sending_networks

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| name | varchar(255) | required |
| created_at | timestamp | |
| updated_at | timestamp | |

**Source:** `src/db/schema/sending-network.ts`

---

### sending_churches

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| name | varchar(255) | required |
| sending_network_id | uuid | FK → sending_networks, nullable |
| created_at | timestamp | |
| updated_at | timestamp | |

**Source:** `src/db/schema/sending-church.ts`

---

## Core Tables

### churches
Multi-tenant root entity (church plant).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| name | varchar(255) | required |
| current_phase | int | default 0 |
| sending_church_id | uuid | FK → sending_churches, nullable |
| sending_network_id | uuid | FK → sending_networks, nullable |
| created_at | timestamp | |
| updated_at | timestamp | |

**Source:** `src/db/schema/church.ts`

---

### users

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| email | varchar(255) | unique, required |
| password_hash | varchar(255) | Argon2id |
| name | varchar(255) | nullable |
| role | varchar(50) | planter/coach/team_member/sending_church_admin/network_admin |
| church_id | uuid | FK → churches, nullable |
| sending_church_id | uuid | FK → sending_churches, nullable |
| sending_network_id | uuid | FK → sending_networks, nullable |
| created_at | timestamp | |
| updated_at | timestamp | |

**Source:** `src/db/schema/user.ts`

---

### sessions

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(255) | PK, SHA-256 of token |
| user_id | uuid | FK → users, cascade delete |
| expires_at | timestamp(tz) | |
| created_at | timestamp(tz) | |
| ip_address | varchar(45) | IPv6 capable |
| user_agent | varchar(512) | |
| country | varchar(2) | ISO 3166-1 |
| city | varchar(100) | |
| fresh | boolean | default true |

**Indexes:** user_id, expires_at

**Source:** `src/db/schema/session.ts`

---

## Wiki Tables

### wiki_sections
Hierarchical navigation.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| slug | text | unique |
| name | text | |
| description | text | nullable |
| icon | text | nullable |
| parent_section_id | uuid | FK → self |
| phase | int | 0-6, nullable |
| sort_order | int | default 0 |

**Source:** `src/db/schema/wiki.ts`

---

### wiki_articles

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| church_id | uuid | FK, null = global |
| slug | text | unique per church |
| title | text | |
| content | text | Raw MDX |
| excerpt | text | nullable |
| content_type | enum | tutorial/how_to/explanation/reference/overview/guide |
| phase | int | 0-6, nullable |
| section_id | uuid | FK → wiki_sections |
| read_time_minutes | int | |
| sort_order | int | default 999 |
| related_article_slugs | text[] | |
| status | enum | draft/published/archived |
| published_at | timestamp | |

**Indexes:** slug+church_id (unique), status, section_id, phase, FTS (gin)

**Source:** `src/db/schema/wiki.ts`

---

### wiki_progress

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users, cascade |
| article_slug | text | links by slug |
| status | enum | not_started/in_progress/completed |
| scroll_position | real | 0-1 |
| last_viewed_at | timestamp | |
| completed_at | timestamp | nullable |

**Indexes:** user_id+article_slug (unique), user_id, last_viewed_at

**Source:** `src/db/schema/wiki.ts`

---

### wiki_bookmarks

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → users, cascade |
| article_slug | text | |
| created_at | timestamp | |

**Indexes:** user_id+article_slug (unique), user_id

**Source:** `src/db/schema/wiki.ts`

---

## People / CRM Tables

### persons
Main person records for CRM tracking.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, required |
| first_name | varchar(255) | required |
| last_name | varchar(255) | required |
| email | varchar(255) | nullable |
| phone | varchar(50) | nullable |
| address_* | varchar | line1, line2, city, state, postal_code, country |
| status | varchar(50) | PersonStatus enum, default "prospect" |
| source | varchar(50) | PersonSource enum |
| source_details | text | |
| notes | text | |
| photo_url | varchar(500) | |
| household_id | uuid | FK → households |
| household_role | varchar(20) | HouseholdRole enum |
| pipeline_sort_order | int | default 0, pipeline card ordering |
| created_by | uuid | FK → users, required |
| created_at | timestamp | |
| updated_at | timestamp | |
| deleted_at | timestamp | soft delete |

**Status Enum:** prospect, attendee, following_up, interviewed, committed, core_group, launch_team, leader

**Source Enum:** personal_referral, social_media, vision_meeting, website, event, partner_church, other

**Indexes:** church_id, status, email, household_id, deleted_at

**Source:** `src/db/schema/people.ts`

---

### households
Family groupings with shared address.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, required |
| name | varchar(255) | required |
| address_* | varchar | line1, line2, city, state, postal_code, country |
| created_at | timestamp | |
| updated_at | timestamp | |

**Source:** `src/db/schema/people.ts`

---

### tags
Church-defined tags for categorizing people.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, required |
| name | varchar(100) | required |
| color | varchar(20) | hex color |
| created_at | timestamp | |

**Source:** `src/db/schema/people.ts`

---

### person_tags
Junction table for person-tag relationships.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches |
| person_id | uuid | FK → persons, cascade delete |
| tag_id | uuid | FK → tags, cascade delete |
| created_at | timestamp | |

**Unique:** (person_id, tag_id)

**Source:** `src/db/schema/people.ts`

---

### assessments
4 C's assessment records.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches |
| person_id | uuid | FK → persons, cascade delete |
| assessed_by | uuid | FK → users |
| committed_score | int | 1-5 |
| compelled_score | int | 1-5 |
| contagious_score | int | 1-5 |
| courageous_score | int | 1-5 |
| total_score | int | 4-20, calculated |
| *_notes | text | notes for each C |
| assessment_date | date | |
| created_at | timestamp | |

**Source:** `src/db/schema/people.ts`

---

### interviews
5-criteria interview records.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches |
| person_id | uuid | FK → persons, cascade delete |
| interviewed_by | uuid | FK → users |
| interview_date | date | |
| maturity_status | varchar(20) | pass/fail/concern |
| gifted_status | varchar(20) | pass/fail/concern |
| chemistry_status | varchar(20) | pass/fail/concern |
| right_reasons_status | varchar(20) | pass/fail/concern |
| season_status | varchar(20) | pass/fail/concern |
| *_notes | text | notes for each criterion |
| overall_result | varchar(30) | qualified/qualified_with_notes/not_qualified/follow_up |
| next_steps | text | |
| created_at | timestamp | |

**Source:** `src/db/schema/people.ts`

---

### commitments
Signed commitment records.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches |
| person_id | uuid | FK → persons, cascade delete |
| commitment_type | varchar(20) | core_group/launch_team |
| signed_date | date | required |
| witnessed_by | uuid | FK → users |
| document_url | varchar(500) | |
| notes | text | |
| created_at | timestamp | |

**Source:** `src/db/schema/people.ts`

---

### skills_inventory
Skills and gifts tracking for team matching.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches |
| person_id | uuid | FK → persons, cascade delete |
| skill_category | varchar(20) | worship/tech/admin/teaching/hospitality/leadership/other |
| skill_name | varchar(100) | required |
| proficiency | varchar(20) | beginner/intermediate/advanced/expert |
| notes | text | |
| created_at | timestamp | |

**Source:** `src/db/schema/people.ts`

---

### person_activities
Activity timeline for people.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches |
| person_id | uuid | FK → persons, cascade delete |
| activity_type | varchar(30) | ActivityType enum |
| metadata | jsonb | additional context |
| performed_by | uuid | FK → users |
| created_at | timestamp | |

**Activity Types:** status_changed, note_added, person_created, person_updated, interview_completed, assessment_completed, commitment_recorded, tag_added, tag_removed

**Source:** `src/db/schema/people.ts`

---

## Access Control Tables

### coach_assignments
Links coaches to church plants they oversee.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| coach_user_id | uuid | FK → users, required |
| church_id | uuid | FK → churches, required |
| assigned_at | timestamp | |
| status | varchar(20) | active/inactive, default "active" |

**Unique:** (coach_user_id, church_id)
**Indexes:** coach_user_id, church_id

**Source:** `src/db/schema/coach-assignment.ts`

---

### organization_invitations
Tracks invitations between hierarchy entities.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| type | varchar(40) | church_to_sending_church/sending_church_to_network/church_to_network |
| inviter_user_id | uuid | FK → users, required |
| target_church_id | uuid | FK → churches, nullable |
| target_sending_church_id | uuid | FK → sending_churches, nullable |
| sending_church_id | uuid | FK → sending_churches, nullable |
| sending_network_id | uuid | FK → sending_networks, nullable |
| status | varchar(20) | pending/accepted/declined/expired/revoked |
| responded_by | uuid | FK → users, nullable |
| responded_at | timestamp | nullable |
| created_at | timestamp | |
| expires_at | timestamp | nullable |

**Indexes:** target_church_id, target_sending_church_id, status, inviter_user_id

**Source:** `src/db/schema/organization-invitation.ts`

---

### church_privacy_settings
Per-feature privacy toggles controlling oversight access.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, unique |
| share_people | boolean | default false |
| share_meetings | boolean | default false |
| share_tasks | boolean | default false |
| share_financials | boolean | default false |
| share_ministry_teams | boolean | default false |
| share_facilities | boolean | default false |
| updated_at | timestamp | |
| updated_by | uuid | FK → users, nullable |

**Source:** `src/db/schema/church-privacy-settings.ts`

---

## Vision Meeting Tables

### locations
Venue/location records for meetings.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, required |
| name | varchar(255) | required |
| address | varchar(500) | required |
| contact_name | varchar(255) | nullable |
| contact_phone | varchar(50) | nullable |
| contact_email | varchar(255) | nullable |
| cost | varchar(50) | e.g., "$150/use" |
| capacity | int | nullable |
| notes | text | |
| is_active | boolean | default true |
| created_at | timestamp | |
| updated_at | timestamp | |

**Indexes:** church_id

**Source:** `src/db/schema/vision-meetings.ts`

---

### vision_meetings
Main meeting records with auto-numbered meetings per church.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, required |
| meeting_number | int | auto-assigned, unique per church |
| datetime | timestamp | required |
| location_id | uuid | FK → locations, nullable |
| location_name | varchar(255) | snapshot/ad-hoc |
| location_address | varchar(500) | snapshot/ad-hoc |
| estimated_attendance | int | nullable |
| actual_attendance | int | nullable, set on finalize |
| status | varchar(50) | planning/ready/in_progress/completed/cancelled |
| notes | text | |
| agenda | jsonb | nullable |
| created_by | uuid | FK → users, required |
| created_at | timestamp | |
| updated_at | timestamp | |

**Unique:** (church_id, meeting_number)
**Indexes:** church_id, status

**Source:** `src/db/schema/vision-meetings.ts`

---

### vision_meeting_attendance
Who attended each meeting.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, required |
| meeting_id | uuid | FK → vision_meetings, cascade delete |
| person_id | uuid | FK → persons, cascade delete |
| attendance_type | varchar(50) | first_time/returning/core_group |
| invited_by_id | uuid | FK → persons, nullable |
| response_status | varchar(50) | interested/ready_commit/questions/not_interested |
| notes | text | |
| created_at | timestamp | |
| updated_at | timestamp | |

**Unique:** (meeting_id, person_id)
**Indexes:** meeting_id, person_id

**Source:** `src/db/schema/vision-meetings.ts`

---

### invitations
Tracks who invited whom to each meeting.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, required |
| meeting_id | uuid | FK → vision_meetings, cascade delete |
| inviter_id | uuid | FK → persons, required |
| invitee_name | varchar(255) | nullable |
| invitee_id | uuid | FK → persons, nullable |
| status | varchar(50) | invited/confirmed/maybe/declined/attended/no_show |
| created_at | timestamp | |
| updated_at | timestamp | |

**Indexes:** meeting_id

**Source:** `src/db/schema/vision-meetings.ts`

---

### meeting_evaluations
Post-meeting evaluation with 8 quality factor scores.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, required |
| meeting_id | uuid | FK → vision_meetings, cascade delete |
| attendance_score | int | 1-5 |
| location_score | int | 1-5 |
| logistics_score | int | 1-5 |
| agenda_score | int | 1-5 |
| vibe_score | int | 1-5 |
| message_score | int | 1-5 |
| close_score | int | 1-5 |
| next_steps_score | int | 1-5 |
| total_score | varchar(10) | average, e.g., "4.2" |
| notes | text | |
| evaluated_by | uuid | FK → users, required |
| created_at | timestamp | |
| updated_at | timestamp | |

**Unique:** (meeting_id) — one evaluation per meeting

**Source:** `src/db/schema/vision-meetings.ts`

---

### meeting_checklist_items
Preparation checklist items auto-populated from kit template.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| church_id | uuid | FK → churches, required |
| meeting_id | uuid | FK → vision_meetings, cascade delete |
| item_name | varchar(255) | required |
| category | varchar(50) | essential/materials/setup/av/organization |
| is_checked | boolean | default false |
| notes | text | |
| assigned_to | uuid | FK → persons, nullable |
| created_at | timestamp | |
| updated_at | timestamp | |

**Indexes:** meeting_id

**Source:** `src/db/schema/vision-meetings.ts`
