# Church Plant Agent — Vision (Pre-FRD)

> **Status:** Future feature, vision capture only. **Not yet an FRD, not scoped for current sprints.** Roughly P3-class (post-beta) per `gap-report-2026-06.md` §3. This document exists so the idea — and the technical decisions tied to it — are not lost, and so we build foundations now that make it cheap later.
> **References (for the eventual FRD):** `product-brief.md`, `system-architecture.md`, and the Phase Engine FRD (`features/phase-engine/frd.md`), with which this feature forms an insight→action loop.

## Concept

A **conversational agent that executes multi-step platform operations from natural language**, collapsing common workflows that today require visiting many screens and dozens of clicks into a single instruction.

Example (the motivating case):
> "Let's create a vision meeting for next Tuesday. Invite everyone who attended the last meeting but hasn't joined the team yet, send them an invite, and add them as guests for the new meeting."

The agent resolves the entities (which meeting, which people), plans the sequence of actions, **shows the planter a preview to confirm**, then executes and reports back — instead of the planter manually creating the meeting, filtering the people list, selecting attendees, composing invites, and adding guests across 5–7 screens.

## Why it matters

- **The app's stated direction.** The app-summary describes a chat-first operations layer; this is its concrete form. The Phase Engine is the *coaching* half; this is the *doing* half.
- **Bivocational reality.** ~69% of planters are bivocational (per the research) and aren't in the app daily. Turning a multi-screen chore into one sentence is direct retention value.
- **Closes the insight→action loop.** Pairs with Plant Intelligence: the judge surfaces *what to do*; the agent *does it*. No competitor closes that loop.

## Example interactions (grounded in existing features)

- "Create a vision meeting for next Tuesday at 7pm; invite last meeting's attendees who haven't joined the team." (F3 + F2 + F9)
- "Who hasn't been followed up with since the last vision meeting? Send them all a check-in." (F2 + F9)
- "Assign Sara to the Worship team as a leader and schedule her for Boot Camp." (F8)
- "Mark everyone who came Sunday as attended and add the three new faces as people." (F3 + F2)

## Technical shape (for the eventual FRD)

This is **genuinely agentic**, unlike the Phase Engine judge (a single structured call). The loop is:

1. **Intent parse** — understand the request.
2. **Plan** — decompose into an ordered sequence of tool calls.
3. **Resolve** — map references to real entities ("the last meeting", "those who attended but haven't joined") via queries.
4. **Confirm (human-in-the-loop)** — render a preview/summary of what will happen and **require approval** before any write or send. Likely **generative UI** (a rendered confirmation component, not just text).
5. **Execute** — run the tools (idempotently where possible), with tenant scoping and audit logging.
6. **Report** — summarize what was done and surface failures.

### The foundational investment (do this now, cheaply)

The agent's "tools" should be the **same typed, permission-checked, church-scoped server actions the UI already calls** (create vision meeting, invite person, add guest, assign team member, …). If we keep mutations as clean, well-typed, auth-guarded server actions — which `AGENTS.md` already mandates — then the agent's tool surface is *mostly already built* by the time we prioritize it. **The cross-cutting requirement that makes this feature cheap later is discipline now:** every feature's mutations exposed as a clean action layer. This is the single most important thing to get right in the interim, and it costs nothing extra.

### Framework decision (deferred — decide at FRD time)

This is where LangGraph was worth raising. The realistic options, given the stack (Next.js / TS / Vercel, already on the Vercel AI SDK for the judge):

| Option | Fits when | Trade-off |
|--------|-----------|-----------|
| **Vercel AI SDK** agent + tool-calling + generative UI (RSC) | Bounded, synchronous action sequences with a confirmation gate (the motivating example fits this) | TS-native, already in the stack, strong generative-UI + human-confirmation support. Lightest path. Less built-in durable/stateful orchestration. |
| **LangGraph(.js)** | Complex stateful graphs: cycles, branching, multi-agent, durable checkpoint/resume across sessions | Most powerful for complex agent control flow; adds a heavier dependency + mental model; JS port less mature than Python. |
| **Vercel Workflow DevKit** (durable workflows) | Long-running / crash-safe / queued actions (e.g., "send 50 invites" with retries, survive a deploy) | Durable execution native to Vercel; complements the AI SDK; not an agent framework itself. |

**Lean:** start the agent on the **AI SDK's agent/tool/generative-UI primitives** — the motivating workflows are bounded sequences with one confirmation, which it handles well, and we're already there for the judge. **Reach for LangGraph if** the orchestration genuinely needs explicit graph state, multi-agent structure, or durable cross-session resume. **Reach for Vercel Workflow DevKit if** actions become long-running/queued and need crash-safe retries. The decision should be driven by *how complex and how durable the action orchestration turns out to be* — not chosen up front. Nothing about building the Phase Engine judge on the AI SDK forecloses any of these.

## Safety & guardrails (non-negotiable for an action agent)

- **Mandatory confirmation** before any write or outbound communication (preview/dry-run first).
- **Tenant scoping** on every tool — the agent can only ever act within the planter's church.
- **Audit logging** of every agent-initiated action (ties to P2-7 audit log / soft-delete).
- **Permission checks** identical to the UI path — the agent has no privileges the user lacks.
- **Reversibility** where feasible (drafts before sends, undo windows).

## Status & next steps

- **Now:** no build. Keep mutations as clean, typed, church-scoped server actions across all features (the agent's future tool layer).
- **When prioritized (post-beta):** write a full FRD; make the framework call then per the table above; design the confirmation/generative-UI pattern; reuse the existing action layer as tools.

## Open questions (for the FRD)

1. Scope of the v1 tool set (which mutations are agent-exposable first?).
2. Confirmation UX — per-action vs per-plan approval; what the generative-UI preview looks like.
3. Synchronous vs durable execution (drives the framework choice).
4. How the agent and the Phase Engine judge share context (the insight→action handoff).
5. Audit / undo model for agent actions.
