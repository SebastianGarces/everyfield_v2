# API Contracts

## Route Handlers

### GET /api/health
Health check endpoint.

**Response:** `{ status: "ok", timestamp: string }`

**Source:** `src/app/api/health/route.ts`

---

### POST /api/wiki/revalidate
Revalidate a specific wiki article cache.

**Auth:** `REVALIDATION_SECRET` in body

**Request:**
```json
{ "slug": "discovery/article-name", "secret": "..." }
```

**Response:** `{ revalidated: true, slug: string, timestamp: string }`

**Source:** `src/app/api/wiki/revalidate/route.ts`

---

### DELETE /api/wiki/revalidate
Revalidate all wiki pages.

**Auth:** `REVALIDATION_SECRET` in body

**Request:** `{ "secret": "..." }`

**Response:** `{ revalidated: true, scope: "all", timestamp: string }`

**Source:** `src/app/api/wiki/revalidate/route.ts`

---

## Server Actions

### Auth Actions

| Action | File | Auth |
|--------|------|------|
| `login(formData)` | `src/app/(auth)/login/actions.ts` | None |
| `register(formData)` | `src/app/(auth)/register/actions.ts` | None |
| `logout()` | `src/lib/auth/actions.ts` | Session |

**Login/Register response:** `{ error?: string, fieldErrors?: {...} }` or redirect

---

### Wiki Actions

| Action | File | Auth |
|--------|------|------|
| `searchWikiArticles(query)` | `src/app/(dashboard)/wiki/actions.ts` | Session |
| `updateProgress(slug, data)` | `src/lib/wiki/progress.ts` | Session |
| `toggleBookmark(slug)` | `src/lib/wiki/bookmarks.ts` | Session |
| `markCompleted(slug)` | `src/lib/wiki/progress.ts` | Session |
| `recordView(slug)` | `src/lib/wiki/progress.ts` | Session |

---

## Validation

All form inputs validated with Zod schemas.

**Source:** `src/lib/validations/`
