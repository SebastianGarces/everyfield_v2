# Database Contracts

ORM: Drizzle | DB: PostgreSQL (Neon serverless)

**Connection:** `src/db/index.ts`

## Core Tables

### churches
Multi-tenant root entity.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| name | varchar(255) | required |
| current_phase | int | default 0 |
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
| role | varchar(50) | planter/coach/team_member/network_admin |
| church_id | uuid | FK → churches, nullable |
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
