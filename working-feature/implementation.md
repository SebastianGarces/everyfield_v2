# Zod Validation Layer - Implementation Plan

**FRD:** N/A (Infrastructure improvement)
**Scope:** Full app validation setup

## Requirements Covered

- Add Zod to tech stack documentation
- Create validation schemas for auth actions
- Replace manual validation in login/register actions

## Implementation Steps

### Phase 1: Setup

- [x] Install Zod dependency
- [x] Update system-architecture.md to include Zod in tech stack
- [x] Create `src/lib/validations/` directory structure

### Phase 2: Auth Validation Schemas

- [x] Create `src/lib/validations/auth.ts` with login and register schemas
- [x] Update `src/app/(auth)/login/actions.ts` to use Zod
- [x] Update `src/app/(auth)/register/actions.ts` to use Zod

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `product-docs/system-architecture.md` | Modify | Add Zod to tech stack table |
| `src/lib/validations/index.ts` | Create | Export all validation schemas and utils |
| `src/lib/validations/auth.ts` | Create | Login and register schemas |
| `src/lib/validations/utils.ts` | Create | Reusable `extractFieldErrors` utility |
| `src/app/(auth)/login/actions.ts` | Modify | Use Zod for validation |
| `src/app/(auth)/register/actions.ts` | Modify | Use Zod for validation |

## Validation Schemas

### Auth Schemas

```typescript
// Login
{
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Please enter your password"),
}

// Register
{
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Please enter your name").transform(v => v.trim()),
  role: z.enum(["planter", "coach", "team_member", "network_admin"]).optional().default("planter"),
}
```
