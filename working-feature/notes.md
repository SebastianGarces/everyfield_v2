# Zod Validation Layer - Implementation Notes

**FRD:** N/A (Infrastructure improvement)
**Date Started:** 2026-01-26

## Goal

Add Zod as the validation layer across the app, replacing manual validation logic with type-safe schemas.

## Key Decisions

- Use Zod for all form validation in server actions
- Create reusable validation schemas in `src/lib/validations/`
- Schemas will mirror database constraints where applicable
- Use `zod` parse errors to generate user-friendly field errors

## Constraints

- Must maintain existing error response shape (fieldErrors pattern)
- Keep validation logic colocated with where it's used (or in shared validations folder)

## Open Questions

- None currently

## Out of Scope

- API route validation (none exist yet)
- Client-side form validation (can add later with react-hook-form)
