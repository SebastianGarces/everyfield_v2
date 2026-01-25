# Session Management - Implementation Plan

**FRD:** N/A (Core infrastructure based on `product-docs/system-architecture.md`)
**Scope:** Session table enhancement + session service + Next.js integration

## Requirements Covered

From `system-architecture.md` Authentication Approach:
- Database-stored sessions for immediate revocability
- Secure session management following Lucia/Copenhagen Book patterns
- Audit logging with user_id and timestamp
- CSRF protection on state-changing requests
- Secure httpOnly cookies with proper SameSite settings

## Current State

```typescript
// src/db/schema/session.ts (current)
export const sessions = pgTable("sessions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
});
```

## Proposed Schema Changes

### 1. Enhanced Sessions Table

```typescript
export const sessions = pgTable("sessions", {
  // Existing fields
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  
  // New fields for security & auditing
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: varchar("ip_address", { length: 45 }), // IPv6 max length
  userAgent: varchar("user_agent", { length: 512 }),
  
  // IP geolocation (resolved at session creation)
  country: varchar("country", { length: 2 }), // ISO 3166-1 alpha-2 code
  city: varchar("city", { length: 100 }),
  
  // Fresh session tracking (for sensitive operations)
  // A session is "fresh" for ~10 minutes after login, requiring re-auth for sensitive ops after
  fresh: boolean("fresh").default(true).notNull(),
});
```

**New Fields Explained:**

| Field | Purpose |
|-------|---------|
| `createdAt` | Track session age, display in "manage sessions" UI |
| `ipAddress` | Security auditing, detect suspicious activity, support "sign out other sessions" |
| `userAgent` | Device identification in "manage sessions" UI (e.g., "Chrome on macOS") |
| `country` | Geolocation - ISO 3166-1 alpha-2 country code (e.g., "US", "GB") |
| `city` | Geolocation - city name for "manage sessions" UI (e.g., "San Francisco") |
| `fresh` | Lucia pattern - fresh sessions allow sensitive ops, stale require re-auth |

### 2. Index Considerations

```typescript
// Add indexes for common queries
export const sessionsUserIdIdx = index("sessions_user_id_idx").on(sessions.userId);
export const sessionsExpiresAtIdx = index("sessions_expires_at_idx").on(sessions.expiresAt);
```

**Rationale:**
- `userId` index: Fast lookup for "get all sessions for user" (manage sessions UI)
- `expiresAt` index: Fast cleanup of expired sessions (background job)

## Implementation Steps

### Phase 1: Schema Update (COMPLETE)

- [x] Update `src/db/schema/session.ts` with new fields
- [x] Add indexes for userId and expiresAt
- [x] Export updated types
- [x] Run `drizzle-kit generate` to create migration
- [x] Review generated migration SQL
- [x] Apply migration with `drizzle-kit migrate`

### Phase 2: Session Service (COMPLETE)

- [x] Create `src/lib/auth/session.ts` with core session functions
- [x] Create `src/lib/auth/cookies.ts` with cookie utilities
- [x] Create `src/lib/auth/index.ts` to export public API

### Phase 3: Next.js Integration (COMPLETE)

- [x] Create `src/proxy.ts` for CSRF protection + cookie refresh (renamed from middleware per Next.js 16)
- [ ] Test session flow end-to-end (manual testing with login/logout integration)

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/db/schema/session.ts` | Modify | Add new fields and indexes (DONE) |
| `src/lib/auth/session.ts` | Create | Core session service (DONE) |
| `src/lib/auth/cookies.ts` | Create | Cookie utilities for Next.js (DONE) |
| `src/lib/auth/index.ts` | Create | Public exports (DONE) |
| `src/proxy.ts` | Create | CSRF protection + cookie refresh (DONE) |
| `src/db/migrations/0000_naive_roland_deschain.sql` | Create | Initial migration with all tables (DONE) |

## Database Schema

### sessions (enhanced)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | varchar(255) | NO | - | Primary key, random token |
| user_id | uuid | NO | - | FK to users.id |
| expires_at | timestamptz | NO | - | Session expiration (30 days) |
| created_at | timestamptz | NO | now() | Session creation time |
| ip_address | varchar(45) | YES | - | Client IP (IPv4/IPv6) |
| user_agent | varchar(512) | YES | - | Browser/device info |
| country | varchar(2) | YES | - | ISO 3166-1 alpha-2 country code |
| city | varchar(100) | YES | - | City name from IP geolocation |
| fresh | boolean | NO | true | Fresh session flag |

### Indexes

| Name | Columns | Purpose |
|------|---------|---------|
| sessions_pkey | id | Primary key |
| sessions_user_id_idx | user_id | Fast user session lookup |
| sessions_expires_at_idx | expires_at | Fast expired session cleanup |

## Session Service API Design

### `src/lib/auth/session.ts`

```typescript
// Token generation (120+ bits entropy)
function generateSessionToken(): string

// Hash token with SHA-256 for storage
function hashToken(token: string): Promise<string>

// Create a new session
async function createSession(
  token: string,
  userId: string,
  metadata: {
    ipAddress?: string;
    userAgent?: string;
    country?: string;
    city?: string;
  }
): Promise<Session>

// Validate session token, returns session + user or null
// Implements sliding window expiration (extends if within 15 days of expiry)
async function validateSessionToken(
  token: string
): Promise<{ session: Session; user: User } | { session: null; user: null }>

// Invalidate a single session (sessionId = hashed token from DB)
async function invalidateSession(sessionId: string): Promise<void>

// Invalidate all sessions for a user (password change, etc.)
async function invalidateUserSessions(userId: string): Promise<void>

// Get all active sessions for a user (manage sessions UI)
async function getUserSessions(userId: string): Promise<Session[]>

// Mark session as no longer fresh (after sensitive op timeout)
async function markSessionStale(sessionId: string): Promise<void>

// Check if session is fresh (for sensitive operations)
function isSessionFresh(session: Session, maxAgeMinutes?: number): boolean

// Cached wrapper for use in server components/actions (per-request dedup)
// Uses React.cache() per server-cache-react best practice
const getCurrentSession = cache(async () => { ... })

// Helper for server actions - verifies session and throws if unauthorized
// Per server-auth-actions: "Authenticate server actions like API routes"
async function verifySession(): Promise<{ session: Session; user: User }>
```

### `src/lib/auth/cookies.ts`

```typescript
// Cookie name constant
const SESSION_COOKIE_NAME = "session"

// Set session cookie with proper attributes
async function setSessionCookie(token: string, expiresAt: Date): Promise<void>

// Delete session cookie
async function deleteSessionCookie(): Promise<void>

// Get session token from cookies
async function getSessionToken(): Promise<string | null>
```

### `src/proxy.ts`

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest): NextResponse {
  // 1. CSRF protection for non-GET requests
  if (request.method !== "GET") {
    const originHeader = request.headers.get("Origin");
    const hostHeader = request.headers.get("Host");
    
    if (!originHeader || !hostHeader) {
      return new NextResponse(null, { status: 403 });
    }
    
    try {
      const origin = new URL(originHeader);
      if (origin.host !== hostHeader) {
        return new NextResponse(null, { status: 403 });
      }
    } catch {
      return new NextResponse(null, { status: 403 });
    }
  }

  // 2. Extend session cookie on GET requests only
  // (Can't detect if server action set new cookie, so only extend on GET)
  if (request.method === "GET") {
    const response = NextResponse.next();
    const token = request.cookies.get("session")?.value ?? null;
    
    if (token !== null) {
      response.cookies.set("session", token, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        sameSite: "lax",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      });
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
```

## Session Lifecycle

### Login Flow
1. Verify credentials
2. `generateSessionToken()` → token (random, given to client)
3. `hashToken(token)` → sessionId (SHA-256 hash, stored in DB as `id`)
4. `createSession(token, userId, metadata)` - internally hashes token to get ID
5. `setSessionCookie(token, expiresAt)` - client gets unhashed token

### Request Validation Flow
1. `getSessionToken()` → token from cookie (unhashed)
2. `validateSessionToken(token)` → hashes token, looks up by ID, returns { session, user } or null
3. If valid + within 15 days of expiry → extend expiration in DB
4. If invalid → `deleteSessionCookie()`

### Logout Flow
1. `getCurrentSession()` → get current session
2. `invalidateSession(session.id)`
3. `deleteSessionCookie()`

### Password Change Flow
1. `invalidateUserSessions(userId)` - invalidate all sessions
2. Create new session for current device
3. `setSessionCookie(newToken, expiresAt)`

### Sensitive Operation Flow
1. `getCurrentSession()` → { session, user }
2. `isSessionFresh(session, 10)` → check if within 10 minutes of auth
3. If not fresh → require re-authentication
4. After re-auth → update session `createdAt` or create new session

### Server Action Pattern (CRITICAL - per server-auth-actions)
```typescript
'use server'

import { verifySession } from '@/lib/auth'

export async function updateProfile(data: FormData) {
  // ALWAYS verify inside the action - middleware is not enough!
  const { session, user } = await verifySession()
  
  // Authorization check
  if (user.id !== data.get('userId')) {
    throw new Error('Unauthorized')
  }
  
  // Perform mutation...
}
```

### API Route Pattern (per async-api-routes)
```typescript
// Start auth check early, await when needed
export async function GET(request: Request) {
  const sessionPromise = getCurrentSession()  // Start immediately
  const configPromise = fetchConfig()          // Independent, start in parallel
  
  const { session, user } = await sessionPromise
  if (!session) {
    return new Response(null, { status: 401 })
  }
  
  // Now await config and user-specific data in parallel
  const [config, data] = await Promise.all([
    configPromise,
    fetchUserData(user.id)
  ])
  
  return Response.json({ data, config })
}
```

## Constants

```typescript
const SESSION_EXPIRY_DAYS = 30
const SESSION_REFRESH_THRESHOLD_DAYS = 15  // Refresh if within this many days of expiry
const FRESH_SESSION_MINUTES = 10           // Session considered "fresh" for this long
```

## Future Considerations (Not in this PR)

These tables may be needed later but are **out of scope** for this implementation:

| Table | Purpose | When Needed |
|-------|---------|-------------|
| `email_verification_tokens` | Email verification during registration | Deferred |
| `password_reset_tokens` | Secure password reset flows | Deferred |
| `oauth_accounts` | Social login (Google, Apple, etc.) | If added later |

## Migration Safety

- All new fields have defaults or are nullable
- No data loss for existing sessions
- Backwards compatible - existing auth code will continue to work
- New fields are additive only
