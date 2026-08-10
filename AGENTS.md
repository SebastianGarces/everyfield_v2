# EveryField Knowledge Index

Decisions, requirements, and rulings live in this repo (FRDs, `memory/`, the GitHub board) — when a question is about what this project *decided* rather than how code works, look it up instead of inferring it.

## Dev Server Rule

**CRITICAL:** NEVER start a dev server yourself (`pnpm dev`, `npm run dev`, etc.). The developer always has a dev server running on `localhost:3000`. If you need to verify it's running, check the terminals folder first. If you don't find one, ask the developer -- do NOT start one yourself.

That server runs the **main checkout**, so it does not serve your feature branch — pointing a browser at `localhost:3000` proves nothing about a change you have not merged. To see your own branch in a browser, use its Vercel preview deployment: `.claude/skills/browser-validation/SKILL.md`.

## Formatting

Formatting is automatic — **do not run `pnpm format` as a routine step**.

- **Agent edits:** a `PostToolUse` hook in `.claude/settings.json` runs `prettier --write` on every file written or edited.
- **Hand edits:** `.vscode/settings.json` sets format-on-save with the Prettier extension.
- **CI:** `format:check` is one of the five required steps (format:check, lint, typecheck, test, build), so anything that slips through fails the PR.

`.prettierignore` excludes `*.md`, so markdown is deliberately unformatted — that is not a hook failure.

There is no pre-commit hook; it was removed once CI became reliable, and the two paths above replace it.

## UI Components (shadcn/ui)

**CRITICAL:** When you need a new UI component, use the shadcn CLI - do NOT write components manually:

```bash
pnpm dlx shadcn@latest add <component-name>
```

Examples:
- Need a checkbox? Run `pnpm dlx shadcn@latest add checkbox`
- Need a popover? Run `pnpm dlx shadcn@latest add popover`
- Need multiple? Run `pnpm dlx shadcn@latest add checkbox popover tabs`

This ensures:
1. Correct dependencies are installed automatically
2. Components match the project's shadcn configuration (new-york style)
3. Consistent patterns across all UI components

Available components: https://ui.shadcn.com/docs/components

## Database Migrations (Drizzle)

**CRITICAL:** Always use `pnpm db:migrate` (which runs `drizzle-kit migrate`) to apply migrations. NEVER use `pnpm db:push` (`drizzle-kit push`). We use explicit, versioned SQL migration files in `src/db/migrations/` to keep changes auditable and reproducible.

## Cursor Pointer Rule

**CRITICAL:** Every clickable element MUST have `cursor-pointer`. This includes buttons, links, tabs, checkboxes, radio buttons, select triggers, clickable cards, and any element with an `onClick` handler. Never ship an interactive element without `cursor-pointer`.

- Native `<button>` and `<a>` tags get this from `globals.css`
- shadcn components (Button, TabsTrigger, SelectTrigger, etc.) must include it in their className
- Custom clickable elements (`<div onClick={...}>`) must always add `cursor-pointer`

## Knowledge Routing

| Task | Read First |
|------|------------|
| Next.js APIs, components, config | `.next-docs/` |
| Invariants, rulings, flow diagrams, non-obvious semantics | `memory/` (TOC: `memory/index.md`) |
| Before ANY mutation | `memory/invariants.md` (every rule, one line each) + the `memory/invariants/<domain>.md` files matching what you are touching |
| Updating `memory/` after a change (DoD gate G4) | `.claude/skills/memory-maintenance/SKILL.md` |
| Email/notification features | `.agents/skills/email-best-practices/`, `.agents/skills/resend/` |
| UI/UX work — implementation, polish, accessibility, typography, color, copy | `.agents/skills/better-interface/` (coordinates the `better-*` suite) |
| Proving a UI change works in a browser | `.claude/skills/browser-validation/SKILL.md` |
| A fuzzy ask, before writing a spec | `.claude/skills/grilling/SKILL.md` |
| A direction question needing a ruling (spec-question hold / needs-spec) | `.claude/skills/prototype/SKILL.md` |
| A merge/rebase conflict (esp. wave branches) | `.claude/skills/resolving-merge-conflicts/SKILL.md` |
| Adding a skill — who may invoke it | `ops/agent-os/invocation.md` |
| The delivery workflow end-to-end (diagram) | `ops/agent-os/workflow.md` |
| What makes work delegable — design-first, modularity, test seams, rule strengths | `ops/agent-os/delegation-rules.md` |
| React performance patterns | `.agents/skills/vercel-react-best-practices/` |
| Feature requirements | `product-docs/features/{feature-name}/frd.md` |
| What is built vs. still open | The board — `gh issue list --label feature`. **Not a file**; the checklists were deleted 2026-07-26 (`ops/agent-os/labels.md`) |

<!-- EVERYFIELD-MEMORY-START -->[Memory Index]|root:./memory|Holds what the code cannot tell you: invariants, rulings, non-obvious semantics, flow diagrams. Read invariants.md before any mutation; for everything else the source is the source of truth. TOC: memory/index.md.<!-- EVERYFIELD-MEMORY-END -->

<!-- EVERYFIELD-SKILLS-START -->[Skills Index]|root:./.agents/skills|One directory per skill. Read its SKILL.md first, then its reference files as needed. Enumerate with `ls .agents/skills/<name>/`.<!-- EVERYFIELD-SKILLS-END -->

<!-- EVERYFIELD-PRODUCT-START -->[Product Docs Index]|root:./product-docs|FRDs live at product-docs/features/<feature>/frd.md; top-level docs include prd.md, product-brief.md, system-architecture.md, core-data-contracts.md. Implementation status lives on the GitHub board (gh issue list --label feature), NOT in any file.<!-- EVERYFIELD-PRODUCT-END -->

<!-- NEXT-AGENTS-MD-START -->[Next.js Docs Index]|root:./.next-docs|This project runs a newer Next.js than your training data — when an API, directive, or config option is in question, search .next-docs/ and read the matching .mdx instead of trusting memory. Browse with `ls`/Glob; the tree mirrors nextjs.org docs (01-app/..., 02-pages/...). If the directory is missing, run: npx @next/codemod agents-md — but note that re-running it regenerates a full file listing between these markers; keep the pointer form instead.<!-- NEXT-AGENTS-MD-END -->
