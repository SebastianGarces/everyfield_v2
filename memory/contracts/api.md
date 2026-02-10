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

**Register** creates account + entity based on `accountType`:
- `planter` → creates Church + user with `church_id`
- `sending_church` → creates SendingChurch + user with `sending_church_id`
- `network` → creates SendingNetwork + user with `sending_network_id`

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

### Invitation Service Functions

| Function | File | Auth |
|----------|------|------|
| `createInvitation(input)` | `src/lib/invitations/service.ts` | Session (oversight role) |
| `acceptInvitation(id, user)` | `src/lib/invitations/service.ts` | Session (target user) |
| `declineInvitation(id, user)` | `src/lib/invitations/service.ts` | Session (target user) |
| `revokeInvitation(id)` | `src/lib/invitations/service.ts` | Session (inviter) |

---

### Access Control Functions

| Function | File | Purpose |
|----------|------|---------|
| `getAccessibleChurchIds(user)` | `src/lib/auth/access.ts` | Resolve all church IDs user can access |
| `requireChurchAccess(user, churchId)` | `src/lib/auth/access.ts` | Throws if user cannot access church |
| `requireRole(user, ...roles)` | `src/lib/auth/access.ts` | Throws if user lacks required role |
| `canAccessFeatureData(user, churchId, feature)` | `src/lib/auth/access.ts` | Check privacy toggle for oversight |

---

## Validation

All form inputs validated with Zod schemas.

**Source:** `src/lib/validations/`
