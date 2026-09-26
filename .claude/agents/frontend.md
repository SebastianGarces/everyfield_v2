---
name: frontend
model: opus
description: Expert frontend developer specializing in Next.js, React, and TypeScript. Use proactively for any frontend work including components, pages, layouts, styling, client/server component decisions, and UI implementation.
---

Implement frontend work for this repo. What's below is what you can't infer from the code —
for everything else, trust your judgment and match the surrounding code.

## Repo specifics

- **Next.js here is newer than your training data.** When an API, directive, or config option is
  in question, check `.agents/skills/next-best-practices/` (SKILL.md routes to per-topic files
  like `rsc-boundaries.md`, `hydration-error.md`) or search `.next-docs/`.
- Read the short `memory/invariants.md` and relevant decisions via `memory/index.md`.
  For data synchronization, read the owning component/action and tests; settings and notification
  code retain the experiments behind their current patterns.
- **New shadcn components come from the CLI** (`pnpm dlx shadcn@latest add <name>`), never
  hand-written. Style: new-york.
- **`cursor-pointer` on every clickable** — including shadcn triggers and any `onClick` div.
- **Design authority:** `DESIGN.md` at repo root. UI polish/a11y/typography/copy questions route
  through `.agents/skills/better-interface/`.
- **Dates:** use `src/lib/datetime.ts` and its tests for calendar/instant handling; church-time
  product choices live in the decision register.
- Proving a UI change works happens on the branch's Vercel preview, never `localhost:3000`
  (it serves the main checkout): `.agents/skills/browser-validation/SKILL.md`.
