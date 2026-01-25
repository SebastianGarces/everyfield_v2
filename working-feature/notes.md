# Session Management - Implementation Notes

**FRD:** N/A (Core infrastructure based on `product-docs/system-architecture.md`)
**Date Started:** 2026-01-25

## Goal

Implement complete session management (schema + service) following Lucia/Copenhagen Book patterns for secure, auditable authentication.

## Key Decisions

- Session-based auth (not JWTs) for immediate revocability
- Store device/browser metadata for security auditing and "manage sessions" UI
- Track session freshness for sensitive operation re-authentication
- Support future multi-device session management
- Store IP geolocation (country + city) at session creation for security UI
- 30-day session expiry with sliding window refresh
- Session token = session ID (simpler Lucia approach, still secure with 120+ bit entropy)
- Use SHA-256 to hash tokens before storage (protection against DB leaks)
- Sliding window: extend expiry when session used within last 15 days
- Use React `cache()` for `getCurrentSession()` to avoid duplicate DB calls
- CSRF protection via Origin header check in middleware

## Constraints

- Must be compatible with existing `users` table foreign key
- Session ID is the SHA-256 hash of the token (stored as hex string, 64 chars)
- All session operations must be church-scoped via the user relationship
- PostgreSQL RLS policies will need updating after schema change

## Architecture Notes

**Token vs ID distinction (from Lucia docs):**
- **Token**: Random string given to client (in cookie), never stored in DB
- **Session ID**: SHA-256 hash of token, stored in DB as primary key
- This protects against DB leaks - attacker with DB access can't impersonate users

**Why SHA-256 for session tokens (not Argon2)?**
- Tokens have 120+ bits of entropy (already unguessable)
- SHA-256 is fast, which is fine for high-entropy secrets
- Argon2 is for low-entropy secrets like passwords

## Next.js Best Practices Applied

From `.agents/skills/vercel-react-best-practices/`:

| Rule | Application |
|------|-------------|
| `server-auth-actions` | Add `verifySession()` helper that throws on unauthorized. Server actions MUST call this - don't rely on middleware alone |
| `server-cache-react` | Wrap `getCurrentSession()` with `React.cache()` for per-request deduplication. Use primitive args (token string) |
| `async-api-routes` | In routes needing auth + other data, start `getCurrentSession()` early, await when needed |
| `server-after-nonblocking` | Use `after()` for session activity logging if needed (not blocking response) |

**Critical from server-auth-actions:**
> "Server Actions are exposed as public endpoints. Always verify authentication **inside** each Server Action—do not rely solely on middleware."

**Cookie handling in middleware:**
- Only extend cookie on GET requests (can't detect if action set new cookie)
- CSRF check on non-GET requests via Origin header

## Open Questions

~~All resolved - see Decisions below~~

## Decisions

- **Email verification tokens:** Not now - defer until needed
- **Password reset tokens:** Not now - defer until needed
- **IP geolocation:** Yes, store country/city from IP at session creation
- **Session expiry:** 30 days with sliding window refresh

## Out of Scope

- Email verification tokens (deferred)
- Password reset tokens (deferred)
- OAuth/social login tables
- Two-factor authentication tables (future feature)
- Rate limiting storage (handled at application/middleware layer)
- CSRF tokens (stored in session cookie, not DB)

## FRD Issues

N/A - This is core infrastructure defined in system-architecture.md, not a feature FRD.
