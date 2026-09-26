# EveryField Knowledge Index

Decisions, requirements, and rulings live in this repo (FRDs, `memory/`, the GitHub board) — when a question is about what this project *decided* rather than how code works, look it up instead of inferring it.

## Hard conventions

- **Validate the selected worktree through managed Portless previews.** Use development mode for hot reload and a clean, committed production-mode snapshot for final runtime evidence. Never use an unrelated server on `localhost:3000` as branch evidence. Start here: `ops/local-previews.md`; browser checks: `.agents/skills/browser-validation/SKILL.md`.
- **Do not run `pnpm format`.** Claude and Codex `PostToolUse` hooks plus Cursor's `afterFileEdit` hook format every file you write, and CI runs `format:check`. `.prettierignore` excludes `*.md`, so unformatted markdown is deliberate.
- **Cross-agent skills live in `.agents/skills/`.** Codex discovers that directory directly; Claude and Cursor use symlinks where their native directories require them. Claude-native workflow sources stay in `.claude/skills/` and `node ops/sync-codex-setup.mjs --write` exposes them to Codex and regenerates `.codex/agents/`.
- **Agent edit hooks share the adapters in `ops/`.** Claude, Cursor, and Codex all run the same Prettier adapter; Claude and Codex also run the same worktree/pnpm guard. Do not add a host-only copy of either rule.
- **New UI components come from the shadcn CLI**, never hand-written: `pnpm dlx shadcn@latest add <component>` (new-york style).
- **Migrations run with `pnpm db:migrate`, never `pnpm db:push`** — versioned SQL in `src/db/migrations/` keeps them auditable.
- **Every clickable element gets `cursor-pointer`** — shadcn components and custom clickables must add it; native `<button>`/`<a>` inherit it from `globals.css`.
- **Never symlink `node_modules` between checkouts** — a fresh worktree gets a real `pnpm install`. pnpm run through such a symlink rewires the checkout it points into and breaks it when the worktree is deleted (guarded by `ops/guard-worktree-pnpm.sh` via hooks, plus a `preinstall` tripwire).

## Knowledge Routing

| Task | Read First |
|------|------------|
| Next.js APIs, components, config | `.next-docs/` |
| Invariants, rulings, architectural intent, non-obvious semantics | `memory/index.md` routes to current decisions and operational notes |
| Before ANY mutation | The short `memory/invariants.md`, then only relevant topics from `memory/index.md` and source/tests |
| Updating `memory/` after a change | `memory/index.md` (same-change maintenance rules) |
| Email/notification features | `.agents/skills/email-best-practices/`, `.agents/skills/resend/` |
| UI/UX work — implementation, polish, accessibility, typography, color, copy | `.agents/skills/better-interface/` (coordinates the `better-*` suite) |
| Local preview setup, modes, data isolation, cleanup | `ops/local-previews.md`, `.agents/skills/portless-preview/SKILL.md` |
| Proving a UI change works in a browser | `.agents/skills/browser-validation/SKILL.md` |
| A fuzzy ask, before writing a spec | `.agents/skills/grilling/SKILL.md` |
| A direction question needing a ruling | `.agents/skills/prototype/SKILL.md` |
| A merge/rebase conflict | `.agents/skills/resolving-merge-conflicts/SKILL.md` |
| How we work — the whole process, one page | `ops/process.md` |
| Codex project setup, hooks, skills, custom agents, worktrees | `ops/codex.md` |
| The engineering principles (auto-injected at session start) | `.agents/skills/principle-*/SKILL.md` |
| React performance patterns | `.agents/skills/vercel-react-best-practices/` |
| The canonical word for a domain term — roles, plant, phase vs. stage, launch, oversight, association | `CONTEXT.md` at the repo root (the ubiquitous-language glossary; it names the deprecated synonyms too) |
| Feature requirements | `product-docs/features/{feature-name}/frd.md` |
| Current product decisions and their rationale | `product-docs/decisions.md` |
| Product values — how tradeoffs are decided | `product-docs/product-values.md` |
| What is built vs. still open | The board — `gh issue list --label feature`. **Not a file**; status never lives in the repo. |

<!-- EVERYFIELD-MEMORY-START -->[Memory Index]|root:./memory|Holds operational facts absent from source/tests. Read the short invariants.md before editing, then only relevant topics from memory/index.md. Product intent: product-docs/decisions.md. Mechanics: source/tests.<!-- EVERYFIELD-MEMORY-END -->

<!-- EVERYFIELD-SKILLS-START -->[Skills Index]|root:./.agents/skills|One directory per skill. Read its SKILL.md first, then its reference files as needed. Enumerate with `ls .agents/skills/<name>/`.<!-- EVERYFIELD-SKILLS-END -->

<!-- EVERYFIELD-PRODUCT-START -->[Product Docs Index]|root:./product-docs|FRDs live at product-docs/features/<feature>/frd.md; top-level docs include prd.md, product-brief.md, system-architecture.md, core-data-contracts.md. Implementation status lives on the GitHub board (gh issue list --label feature), NOT in any file.<!-- EVERYFIELD-PRODUCT-END -->

<!-- NEXT-AGENTS-MD-START -->[Next.js Docs Index]|root:./.next-docs|This project runs a newer Next.js than your training data — when an API, directive, or config option is in question, search .next-docs/ and read the matching .mdx instead of trusting memory. Browse with `ls`/Glob; the tree mirrors nextjs.org docs (01-app/..., 02-pages/...). If the directory is missing, run: npx @next/codemod agents-md — but note that re-running it regenerates a full file listing between these markers; keep the pointer form instead.<!-- NEXT-AGENTS-MD-END -->
