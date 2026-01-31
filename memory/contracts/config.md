# Configuration Contracts

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXT_PUBLIC_APP_URL` | No | Base URL (default: localhost:3000) |
| `REVALIDATION_SECRET` | For prod | Wiki cache revalidation auth |

**Source:** `.env.example`

---

## Constants

### Session

| Constant | Value | Location |
|----------|-------|----------|
| SESSION_EXPIRY_DAYS | 30 | `src/lib/auth/session.ts` |
| SESSION_REFRESH_THRESHOLD_DAYS | 15 | `src/lib/auth/session.ts` |
| FRESH_SESSION_MINUTES | 10 | `src/lib/auth/session.ts` |
| SESSION_COOKIE_NAME | "session" | `src/lib/auth/cookies.ts` |

### Password Hashing (Argon2id)

| Param | Value |
|-------|-------|
| memoryCost | 19456 KiB |
| timeCost | 2 |
| outputLen | 32 |
| parallelism | 1 |

**Source:** `src/lib/auth/password.ts`

---

## Cookie Settings

| Cookie | httpOnly | secure | sameSite |
|--------|----------|--------|----------|
| session | true | prod only | lax |
| sidebar_state | false | - | - |

**Source:** `src/lib/auth/cookies.ts`

---

## Feature Flags

No feature flags currently implemented.

---

## Navigation Config

Main nav and wiki nav defined in `src/lib/navigation.ts`.

Features marked `isDisabled: true` are planned but not implemented.
