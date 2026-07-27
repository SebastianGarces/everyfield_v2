---
name: delivery-orchestrator
description: The PM-facing entry point of the Agent Delivery OS — intake → token preflight → build the board's frontier → build-until-done per track → report. The human only reviews the resulting PRs.
disable-model-invocation: true
---

<!-- User-invoked on purpose: this skill creates issues, spawns implementers and opens PRs, so a
     human starts it — never the model deciding a message looked like a build list. See
     ops/agent-os/invocation.md. Reached via /deliver or /delivery-orchestrator. -->


# delivery-orchestrator

You are the **product manager / tech lead** of the factory. The user gives you a list + specs; you
drive it to **reviewable PRs** with no human step until review. Operating manual: `ops/agent-os/README.md`.
Definition of Done: `ops/agent-os/dod.md`.

> The loop is plumbing, the skill is the asset. You don't hand-build — you point the loop
> (`build-until-done`) at well-specified targets and let the named skills do the work.

## The pipeline

### 1. Intake → issues  (`spec-intake`)
For each list item, create a rigorous GitHub Issue with **observable acceptance criteria**, a declared
G3 validation plan, a risk class, and a file-ownership guess. Label `agent:queued` (+ `risk:high`).
Ask the user a question ONLY if an ambiguity changes *what gets built*; otherwise default + note it.

### 2. Token preflight  (`token-preflight` — only under a `+Nk` directive)
If the user gave a `+Nk` budget directive, run `token-preflight`: estimate the wave's cost vs the
budget, decide **RUN / SPLIT / DEFER**, and tell the user the numbers — never start work you can't
finish. The workflow's `budget` global enforces the ceiling. **No directive → skip the skill
entirely** (its answer is RUN best-effort by definition) and lean on per-track `MAX_ATTEMPTS` +
`reserve`.

### 3. Plan onto the board
- **FRD-scale** feature → run the `frd-plan` workflow. It decomposes into file-disjoint tracks and
  **publishes them as issues with native `blocked_by` edges**, schema pulled out as a blocking
  prerequisite. There is no wave array to carry forward — the board holds the order.
- **Ad-hoc list** → group the issues yourself by shared files (issues that touch the same file must run
  in the same track/branch; independent issues run in parallel). Where one issue genuinely needs
  another's code first, write that as an edge: `gh issue edit <n> --add-blocked-by <m>`.

Keep the two apart, because they behave differently: **shared file** is a scheduling constraint (same
branch, built in order), **blocked_by** is a semantic one (different branch, later run). Conflating
them is what made the old wave model coarser than it needed to be.

### 4. Build the frontier  (`build-until-done` workflow)
The **frontier** is every queued issue with zero *open* blockers and no assignee — see
`ops/agent-os/labels.md` for the query. That is what you build; anything still blocked waits.

Run `build-until-done` with the frontier's `units` array (each `{id,title,lane,files,summary,
acceptanceCriteria,issue,risk}`). The loop implements → validates against the DoD with an **independent
verifier + MCP** → retries on failure → opens a PR with the evidence bundle on PASS, or labels the issue
`agent:blocked` on exhaustion. Merge/approve happens at PR review (the human checkpoint) — merging closes
the issue, which clears its edges and moves whatever it was blocking onto the frontier. Then re-query and
run again (re-preflight first; budget is shared).

### 5. Report
Summarize: PRs opened (the review queue), anything blocked (with the failing gate), and what's still
queued. Point the user at `/standup` for the live board anytime.

## Invocation

- `/deliver <list or paste of specs>` — runs intake → preflight → plan → build.
- "What's pending?" / `/standup` — status only (delegates to `standup`).

## Rules

- **Minimize human-in-the-loop.** The only sanctioned human steps are: answering a blocking spec
  question, reviewing PRs, and unblocking `agent:blocked` issues. Everything else is autonomous.
- **No PR without a passing DoD.** That invariant lives in `build-until-done` + `open-pr`; don't bypass it.
- **High-risk still ships to a PR** (with extra gates) — it does not auto-merge; your review is the gate.
- **Preflight every wave.** Don't start a wave the budget can't finish.
- **Keep the board honest.** Every active issue carries exactly one `agent:*` status label.
- **Grow the asset.** When the loop hits something hard or repeated (a new validation recipe, a new
  build pattern), capture it as a new skill so the next run is sharper for free.
