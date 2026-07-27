# Alpha Release — Plan of Record (2026-07-27)

**Status:** planning record, point-in-time. Live status is the board: the **Alpha Release** milestone
(`gh issue list --milestone "Alpha Release"`). This document records why the milestone contains what
it contains, so the reasoning survives the issues closing. Do not add status checkboxes here (§6 of
the requirements-docs rules).

**Method:** four parallel audit agents surveyed the codebase on `main` (sending/oversight side,
accounts/roles/multi-user access, planter onboarding, business/production surface), cross-checked
against `product-brief.md`, `docs-audit-2026-07.md`, and the board. Every claim below was verified
against a concrete `file:line` at audit time; the full evidence lives in the milestone issues.

---

## 1. The release in one paragraph

Alpha is an **invite-gated cohort release** into The SEND Network, sourced through Brett and Bryan's
relationships. The user we must impress is the **oversight side** — sending churches and the network —
which means the alpha bar is not "the planter tools work" (they largely do) but "a sending-church
admin can invite a planter, the planter can onboard a real mid-journey plant, and the admin sees
portfolio value on `/oversight`." Initial users get free access; pricing and the free-period terms
are open decisions (#192). Payments are recommended **out** of alpha scope.

## 2. What the audit found (2026-07-27)

### The good surprises

- **The sending/oversight side is a complete backend with almost no frontend** — not greenfield.
  Schema (`sending_networks`, `sending_churches`, `organization_invitations`,
  `church_privacy_settings`), the full invitation/association service (`src/lib/invitations/service.ts`,
  11 functions), role-based access (`src/lib/auth/access.ts`), and privacy-gated oversight reads all
  shipped in commit `1ac8eb1` and were never wired to UI. The alpha work here is wiring.
- **Core-team CSV import is fully built** (`src/lib/people/import.ts` + wizard on `/people`) — it
  just isn't surfaced to a new user.
- **The in-app feedback loop is half done**: widget, `feedback` table with a status lifecycle, email
  notify, and `/admin/feedback` triage all exist. Only the GitHub bridge is missing.
- **Ops are solid**: Sentry fully configured (server/edge/client + source maps), daily phase-engine
  cron, Postgres-backed auth rate limiting, Svix-verified Resend webhooks, five-step CI.

### The gaps, by the questions asked

| Question | Finding |
|----------|---------|
| Sending church/network side | 4 of 6 advertised oversight nav routes 404 (`src/lib/navigation.ts:107-139`); invitation lifecycle has no UI; privacy toggles are permanently deny-all (no code path updates them); no association audit table. |
| Associations both directions | Org-to-org association (plant ↔ sending church ↔ network) is service-complete, UI-absent. Person-to-account direction (pastor → core team members → dashboard access) **does not exist**: no user invitations, no `coach_assignments` write path, `requireRole` called only twice app-wide, `persons` (CRM) and `users` are unlinked. |
| Planter onboarding | Two text fields end-to-end. No location column, `launchDate` never written (countdown signal permanently empty), no initial-phase declaration — every plant starts at phase 0 and mid-journey planters would fabricate transition history. |
| Business surface | Landing page is a "Development preview" placeholder; zero legal pages; zero payments code **and no entitlement primitive to gate free vs paid**; zero analytics (PostHog not installed). |
| Production provisioning | Domain mismatch (`everyfield.app` metadata vs `everyfield.com` email default); no Resend domain auth (SPF/DKIM/DMARC); `.env.example` documents ~15 of 29 env vars; cosmetic health check; no backup/restore doc. |

### Critical bug

`createChurch` updates every user with `church_id IS NULL` — the WHERE clause lacks the user-id
predicate (`src/app/(dashboard)/dashboard/actions.ts:55-59`). One planter creating a church absorbs
every pending planter **and every oversight admin** into their tenant. Found independently by three
audit agents. Filed as **#183** (`risk:high`), first item to fix.

## 3. Milestone contents and why

Milestone: **Alpha Release** (milestone #2). An older empty **Beta** milestone (#1) also exists;
proposed naming — Alpha = SEND cohort, Beta = wider release — awaits the #193 ruling.

### New issues filed 2026-07-27

| Issue | What | Type |
|-------|------|------|
| #183 | `createChurch` cross-tenant bug | `bug`, `risk:high`, queued |
| #184 | Planter onboarding — capture where the plant actually is (folds in #157's ruling; initial-phase declaration, launch date, location, CSV-import surfacing) | `needs-spec` |
| #185 | Core team member accounts — user invitations, persons↔users link, coach assignment write path, role enforcement sweep, team-member experience | `needs-spec`, `risk:high` |
| #186 | Finish the oversight surfaces the sidebar already promises (plants list, invitation lifecycle UI, dead-link interim fix, association audit) | `needs-spec` |
| #187 | Church settings — name, launch date, privacy sharing toggles | `needs-spec` |
| #188 | Public landing page | `needs-spec` |
| #189 | Terms of service + privacy policy pages (content needs Sebastian's review; covers CRM-data-about-non-users and the OpenAI posture) | queued |
| #190 | Feedback → GitHub issue bridge (one-way, fire-and-forget) | queued, `risk:high` |
| #191 | Production provisioning checklist (domain, email auth, env vars, backups, health probe, analytics decision) | ops |
| #192 | **Decision:** pricing, free period, whether payments exist in alpha, who the paying customer is | `decision` |
| #193 | **Decision:** alpha cohort, the demo path that must not break, success criteria, milestone naming | `decision` |

### Existing issues pulled into the milestone

#16 (wiki churchId fix), #22 (F8 role-tier authorization), #23 (oversight invitations UI),
#28 (playbook-grounded empty states), #31 (beta mechanics), #62 (wiki privacy toggle),
#106/#107 (OpenAI sharing off + plain-language disclosure — ruled to ship together),
#157 (planter/pastor assignment — direction already given, folds into #184's spec).

### The demo path (proposed alpha exit condition, ruled in #193)

> Sending-church admin signs up → invites a planter → planter accepts, onboards a mid-journey plant
> (declares phase, launch date), imports core team CSV → runs a vision meeting with attendance and
> follow-ups → phase engine produces insights → the admin sees portfolio health on `/oversight`,
> with data the planter chose to share via privacy toggles.

Every link in that chain maps to a milestone issue. When the chain runs clean end-to-end, alpha is
feature-ready; what remains is provisioning (#191) and the two decisions.

## 4. Business analysis summary

- **Payments:** not needed for alpha (recommendation, pending #192). The invite gate already
  controls access; the free-period *terms* must be decided so signup and the ToS can state them.
- **Pricing:** shape was ruled 2026-02-03 (Free = Wiki + Phase 0; Paid = create a church) but no
  amount, and no entitlement mechanism exists. The sharper question is **who pays** — planter vs
  sending org per plant vs network license. Network-pays matches how SEND funds planters and the
  Feb 7 "networks are the GTM channel" ruling. Comps and framing in #192.
- **Legal exposure worth respecting:** planters enter personal data about *third parties*
  (congregants — contacts, addresses, pastoral notes), and phase-engine data goes to OpenAI with
  sharing deliberately ON until the beta flip (#106). The privacy policy (#189) and disclosure
  (#107) are alpha-blocking for trust reasons, not box-ticking.
- **Explicitly out of alpha (proposed in #193):** payments/billing, F7 financial tracking (already
  deferred), SMS + scheduled send, free Phase-0 public toolkit (#27), plant micro-sites (#26),
  migration wizard beyond CSV (#32), network wiki customization (#178).

## 5. How to resume this work

1. Rule #192 and #193 (surface at `/standup`).
2. Fix #183 (in progress as of this document's merge).
3. Spec the `needs-spec` issues — suggested order: #184 (onboarding), #186 (oversight), #187
   (settings), #185 (team accounts — needs the duties ruling first, likely via the prototype flow),
   #188 (landing).
4. Everything queued flows through the normal delivery OS (dispatch → build-until-done → DoD → PR).
