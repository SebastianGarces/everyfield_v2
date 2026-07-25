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
| Training on API data | **No.** Since 2023-03-01 API data is not used to train or improve models unless explicitly opted in. We have not opted in. |
| Abuse-monitoring retention | **Up to 30 days**, "unless longer retention is required by law, or is reasonably necessary to protect our services" |
| Stored completions | **Off.** `store` is never set on the judge call (`judge/provider.ts`); the default is off. |
| Zero Data Retention | **Not available to us.** See below. |

### Why ZDR is not simply switched on

ZDR and Modified Abuse Monitoring live at **Settings → Organization → Data controls → Data
Retention**, configurable org-wide with per-project override. But the options themselves are gated:
OpenAI's documentation states these controls are "subject to prior approval by OpenAI and acceptance
of additional requirements," obtained through their sales team and aimed at enterprise accounts.

A pre-revenue account cannot obtain them at any price. That is why **NFR-PE-4** requires a
documented and disclosed posture rather than zero retention, with ZDR as a Should Have for when the
account is contractually eligible. Revisit at the enterprise, post-revenue stage.

**The honest summary for a planter:** their plant's numbers pass through OpenAI, are not trained on,
and may sit in abuse-monitoring storage for up to 30 days. No names or contact details are sent.

## Review triggers

Re-check this document when any of these change:

- The judge provider or model (`judge/provider.ts`)
- The snapshot shape — especially anything adding a name, email, or free-text field
- Langfuse moving off self-hosting
- The OpenAI account becoming eligible for ZDR or Modified Abuse Monitoring
- The first real (non-eval) church whose data goes through the judge
