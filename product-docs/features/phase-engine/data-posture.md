# Plant Intelligence — Data Posture

> Satisfies **NFR-PE-4a** (record the provider and its data-handling terms). Written 2026-07-25.
> This is the document to hand someone who asks "what happens to our church's data?"

## What actually leaves the building

Assessment sends a **deterministic fact snapshot** to the model — not the database. The snapshot
shape is `PlantFactSnapshot` in `src/lib/phase-engine/signals/types.ts`, and it is overwhelmingly
counts, dates and phase state:

| Sent | Not sent |
|---|---|
| Aggregate counts (committed people, meetings held, roles filled) | Names |
| Dates and derived intervals (days since, cadence, countdown) | Email addresses |
| Phase number and readiness state | Phone numbers |
| Per-person **UUIDs** with countable attributes — status, tenure in days, meetings attended, active memberships | Addresses, notes, message bodies |
| Free-text values a planter typed into a **manual attestation** | Anything from other churches |

Two things deserve emphasis because they are easy to get wrong when describing this:

- **`personId` is a UUID, not an identity.** The one person-level structure
  (`LeadershipReadinessSignal`) carries an opaque id plus countable attributes. The provider
  receives no way to know who that is. A network-audience insight that cites a `personId` is
  additionally **dropped at persistence time** (`assessment/persist.ts`) so individuals never surface
  to oversight.
- **Manual attestations are the one free-text channel.** `ManualAttestation.value` is `unknown` —
  whatever a planter types. If free text ever needs to stay in-house, this is the field to constrain.

Retrieval context (methodology RAG) is EveryField's own wiki and playbook content — no plant data.

## Where it goes

| Destination | What | Posture |
|---|---|---|
| **OpenAI** (`gpt-4o` via Vercel AI SDK) | The fact snapshot + rubric, one `generateObject` call per assessment | See below |
| **Langfuse** | Judge traces (prompt, response, rubric version, model id) | **Self-hosted** — traces stay on infrastructure we control. Currently unconfigured, so tracing no-ops. |
| **Sentry** | Errors and 10% performance traces, production only | Not a deliberate plant-data channel, but an exception message can incidentally carry data. `sendDefaultPii` is not enabled. |
| **Neon** | Everything, at rest | Tenant-scoped by `church_id` |

## OpenAI's terms, as they apply to us

| | |
|---|---|
| Training on API data | **Not by default** — since 2023-03-01, unless explicitly opted in. **This account is currently opted in**, by decision, until beta. See below. |
| Abuse-monitoring retention | **Up to 30 days**, "unless longer retention is required by law, or is reasonably necessary to protect our services" |
| Call retention | The judge uses the **Responses API**, which OpenAI logs by default. Now opted out in code with `store: false`. See below. |
| Zero Data Retention | **Not available to us.** See below. |

### What the audit found (2026-07-25)

Reading the dashboard rather than assuming the defaults turned up two things, both now corrected.
Recorded here because "we assumed the defaults" is how this goes wrong again.

**1. Inputs and outputs were being shared with OpenAI.** Under **Data controls → Sharing**, "Share
inputs and outputs with OpenAI" was **Enabled for all projects** — the opt-in that trades traffic
for complimentary daily tokens, and it explicitly includes "improving and training our models". Two
sibling toggles (model feedback, evaluation and fine-tuning data) were on as well. This is the
opposite of the default posture, and it applied to real church data.

**2. Every judge call was being retained.** The AI SDK's `openai(modelId)` resolves to the
**Responses API**, not Chat Completions, and the Responses API logs prompts and completions by
default — the SDK defaults `store` to `true`. So each assessment's fact snapshot and output sat in
the org's logs.

**Fixed now:** `store: false` on the judge call, in code, so the retention opt-out travels with the
feature rather than with one account's settings.

**Deliberately not fixed yet — sharing stays on until beta.** "Share inputs and outputs with OpenAI"
remains **enabled**, a considered decision on 2026-07-25: the complimentary daily tokens are worth
more than the exposure while the only data flowing through the judge is the eval corpus and
friendly test plants. **This must be disabled before any beta release with real churches** — it is
tracked as a Must Have gate on the checklist, not a nice-to-have.

While it stays on, the true statement is: **plant data sent to the judge is shared with OpenAI,
including for improving and training their models.** Any disclosure written before that toggle flips
has to say so — see NFR-PE-4c. A disclosure that describes the post-beta posture while the pre-beta
one is live would be worse than no disclosure at all.

**Assessments that ran before 2026-07-25 were also retained** in the org's logs, on top of being
shared. That covers the eval corpus and Bryan and Brett's plants.

### Why ZDR is not simply switched on

ZDR and Modified Abuse Monitoring live at **Settings → Organization → Data controls → Data
Retention**, configurable org-wide with per-project override. But the options themselves are gated:
OpenAI's documentation states these controls are "subject to prior approval by OpenAI and acceptance
of additional requirements," obtained through their sales team and aimed at enterprise accounts.

A pre-revenue account cannot obtain them at any price. That is why **NFR-PE-4** requires a
documented and disclosed posture rather than zero retention, with ZDR as a Should Have for when the
account is contractually eligible. Revisit at the enterprise, post-revenue stage.

**The honest summary for a planter, today:** their plant's numbers — counts and dates, no names or
contact details — pass through OpenAI, are **currently shared with OpenAI including for training
their models**, and may sit in abuse-monitoring storage for up to 30 days. They are no longer
retained in our organization's call logs.

**The summary at beta,** once sharing is disabled: the same, minus the training and sharing. Do not
use this version until the toggle is actually off.

## Review triggers

Re-check this document when any of these change:

- The judge provider or model (`judge/provider.ts`)
- The snapshot shape — especially anything adding a name, email, or free-text field
- Langfuse moving off self-hosting
- The OpenAI account becoming eligible for ZDR or Modified Abuse Monitoring
- The first real (non-eval) church whose data goes through the judge
