# EveryField Knowledge Index

Decisions, requirements, and rulings live in this repo (FRDs, `memory/`, the GitHub board) — when a question is about what this project *decided* rather than how code works, look it up instead of inferring it.

## Hard conventions

- **NEVER start a dev server.** One already runs on `localhost:3000` and it serves the **main checkout**, so it never contains your branch. Use the branch's Vercel preview: `.claude/skills/browser-validation/SKILL.md`.
- **Do not run `pnpm format`.** A `PostToolUse` hook formats every file you write, and CI runs `format:check`. `.prettierignore` excludes `*.md`, so unformatted markdown is deliberate.
- **New UI components come from the shadcn CLI**, never hand-written: `pnpm dlx shadcn@latest add <component>` (new-york style).
- **Migrations run with `pnpm db:migrate`, never `pnpm db:push`** — versioned SQL in `src/db/migrations/` keeps them auditable.
- **Every clickable element gets `cursor-pointer`** — shadcn components and custom clickables must add it; native `<button>`/`<a>` inherit it from `globals.css`.

## Knowledge Routing

| Task | Read First |
|------|------------|
| Next.js APIs, components, config | `.next-docs/` |
| Invariants, rulings, architectural intent, non-obvious semantics | `memory/` (TOC: `memory/index.md`) |
| Before ANY mutation | `memory/invariants.md` (every rule, one line each) + the `memory/invariants/<domain>.md` files matching what you are touching |
| Updating `memory/` after a change | `ops/agent-os/dod.md` § Memory |
| Email/notification features | `.agents/skills/email-best-practices/`, `.agents/skills/resend/` |
| UI/UX work — implementation, polish, accessibility, typography, color, copy | `.agents/skills/better-interface/` (coordinates the `better-*` suite) |
| Proving a UI change works in a browser | `.claude/skills/browser-validation/SKILL.md` |
| A fuzzy ask, before writing a spec | `.claude/skills/grilling/SKILL.md` |
| A direction question needing a ruling | `.claude/skills/prototype/SKILL.md` |
| A merge/rebase conflict | `.claude/skills/resolving-merge-conflicts/SKILL.md` |
| How work is delivered — the contract, the pass graph, rulings, invocation, what makes work delegable | `ops/agent-os/README.md` |
| When work may become a PR — the four gates | `ops/agent-os/dod.md` |
| The board — status labels and the frontier query | `ops/agent-os/labels.md` |
| React performance patterns | `.agents/skills/vercel-react-best-practices/` |
| The canonical word for a domain term — roles, plant, phase vs. stage, launch, oversight, association | `CONTEXT.md` at the repo root (the ubiquitous-language glossary; it names the deprecated synonyms too) |
| Feature requirements | `product-docs/features/{feature-name}/frd.md` |
| Dated product decisions (the ledger) | `product-docs/decisions.md` |
| Product values — how tradeoffs are decided | `product-docs/product-values.md` |
| What is built vs. still open | The board — `gh issue list --label feature`. **Not a file**; status never lives in the repo. |

<!-- EVERYFIELD-MEMORY-START -->[Memory Index]|root:./memory|Holds what the code cannot tell you: invariants, rulings, non-obvious semantics, architectural intent. Read invariants.md before any mutation; for everything else the source is the source of truth. TOC: memory/index.md.<!-- EVERYFIELD-MEMORY-END -->

<!-- EVERYFIELD-SKILLS-START -->[Skills Index]|root:./.agents/skills|One directory per skill. Read its SKILL.md first, then its reference files as needed. Enumerate with `ls .agents/skills/<name>/`.<!-- EVERYFIELD-SKILLS-END -->

<!-- EVERYFIELD-PRODUCT-START -->[Product Docs Index]|root:./product-docs|FRDs live at product-docs/features/<feature>/frd.md; top-level docs include prd.md, product-brief.md, system-architecture.md, core-data-contracts.md. Implementation status lives on the GitHub board (gh issue list --label feature), NOT in any file.<!-- EVERYFIELD-PRODUCT-END -->

<!-- NEXT-AGENTS-MD-START -->[Next.js Docs Index]|root:./.next-docs|This project runs a newer Next.js than your training data — when an API, directive, or config option is in question, search .next-docs/ and read the matching .mdx instead of trusting memory. Browse with `ls`/Glob; the tree mirrors nextjs.org docs (01-app/..., 02-pages/...). If the directory is missing, run: npx @next/codemod agents-md — but note that re-running it regenerates a full file listing between these markers; keep the pointer form instead.<!-- NEXT-AGENTS-MD-END -->
