# User Sidenav Dropdown Fixes - Implementation Notes

**FRD:** N/A (Bug fix / behavior correction)
**Date Started:** 2026-01-26

## Goal

Fix the user dropdown in the sidenav to use actual logout functionality and display real user data instead of hardcoded placeholders.

## Key Decisions

- Use the existing `logout()` server action from `@/lib/auth/actions`
- Pass user data from dashboard layout (where session is validated) down to AppSidebar
- Generate initials from user's name (or fallback to email)

## Constraints

- `NavUser` is a client component (uses `useSidebar` hook)
- `logout()` is a server action - can be called from client components
- Dashboard layout is a server component - can fetch session data

## Open Questions

- None

## Out of Scope

- User profile/settings page implementation
- Avatar image support (only initials for now)
