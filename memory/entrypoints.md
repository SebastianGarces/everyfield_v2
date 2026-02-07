# Entrypoints

## Authentication

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Login | `src/app/(auth)/login/actions.ts:login()` | Form submit |
| Register | `src/app/(auth)/register/actions.ts:register()` | Form submit |
| Session validation | `src/lib/auth/session.ts:getCurrentSession()` | Every authenticated request |
| Logout | `src/lib/auth/actions.ts:logout()` | User action |

**Primary modules:** `src/lib/auth/`, `src/db/schema/session.ts`, `src/db/schema/user.ts`

**Key deps:** `sessions` table, `users` table, `session` cookie

---

## Wiki

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Article view | `src/app/(dashboard)/wiki/[...slug]/page.tsx` | Route `/wiki/*` |
| Article retrieval | `src/lib/wiki/get-article.ts:getArticle()` | Page render |
| Search | `src/app/(dashboard)/wiki/actions.ts:searchWikiArticles()` | Search input |
| Progress update | `src/lib/wiki/progress.ts:updateProgress()` | Article scroll/view |
| Bookmark toggle | `src/lib/wiki/bookmarks.ts:toggleBookmark()` | User action |
| Cache revalidation | `src/app/api/wiki/revalidate/route.ts` | POST with secret |

**Primary modules:** `src/lib/wiki/`, `src/components/wiki/`, `src/db/schema/wiki.ts`

**Key deps:** `wiki_articles`, `wiki_sections`, `wiki_progress`, `wiki_bookmarks` tables

---

## Dashboard

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Layout auth guard | `src/app/(dashboard)/layout.tsx` | Any `/dashboard/*` route |
| Dashboard page | `src/app/(dashboard)/dashboard/page.tsx` | Route `/dashboard` |

**Primary modules:** `src/app/(dashboard)/`, `src/components/`

**Key deps:** `getCurrentSession()`, sidebar state cookie

---

## People / CRM

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| People list | `src/app/(dashboard)/people/page.tsx` | Route `/people` |
| Person detail | `src/app/(dashboard)/people/[id]/page.tsx` | Route `/people/[id]` |
| Activity tab | `src/app/(dashboard)/people/[id]/activity/page.tsx` | Route `/people/[id]/activity` |
| Create person | `src/app/(dashboard)/people/actions.ts:createPersonAction()` | Form submit |
| Update person | `src/app/(dashboard)/people/actions.ts:updatePersonAction()` | Form submit |
| Delete person | `src/app/(dashboard)/people/actions.ts:deletePersonAction()` | User action |
| Change status | `src/app/(dashboard)/people/actions.ts:changeStatusAction()` | Drag-drop / Modal |
| Change status w/reason | `src/app/(dashboard)/people/actions.ts:changeStatusWithReasonAction()` | Modal submit |
| Add note | `src/app/(dashboard)/people/actions.ts:addNoteAction()` | Form submit |
| Tag management | `src/app/(dashboard)/people/actions.ts:*TagAction()` | User action |

**Primary modules:** `src/lib/people/`, `src/components/people/`, `src/db/schema/people.ts`

**Key deps:** `persons`, `households`, `tags`, `person_tags`, `assessments`, `interviews`, `commitments`, `skills_inventory`, `person_activities` tables

**Status flow:** See `memory/flows/person-status.mmd`

---

## API Routes

| Route | File | Method |
|-------|------|--------|
| `/api/health` | `src/app/api/health/route.ts` | GET |
| `/api/wiki/revalidate` | `src/app/api/wiki/revalidate/route.ts` | POST, DELETE |

---

## Database

| Connection | File |
|------------|------|
| DB instance | `src/db/index.ts` |
| Schema exports | `src/db/schema/index.ts` |

**Migrations:** `src/db/migrations/`
