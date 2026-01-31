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
