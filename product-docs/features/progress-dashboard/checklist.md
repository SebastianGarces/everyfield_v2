# Progress Dashboard – Implementation Checklist

## Must Have

- [ ] D-001: Current phase display with visual progress indicator
  - Partial: phase shown as a text label in the dashboard header (`src/app/(dashboard)/dashboard/page.tsx`); no visual phase stepper on the dashboard — phase visuals live on `/phase`
- [ ] D-002: Phase exit criteria progress
  - Diverged: readiness is currently advisory and LLM-judged via the Plant Intelligence Engine on `/phase` (`src/app/(dashboard)/phase/page.tsx`); no deterministic exit-criteria model exists — pending decision (FRD Open Question 6)
- [ ] D-003: Core Group size metric with target progress
  - Partial: count shown with the FRD status calculation (`src/lib/dashboard/service.ts` getDashboardMetrics()); no min-50/target-100 progress bar or monthly delta
- [ ] D-004: Launch countdown (when date is set)
  - Not on the planter dashboard; `daysUntilLaunch` computed only for the oversight plant-health surface (`src/lib/phase-engine/oversight/read.ts`)
- [ ] D-005: 8 Critical Success Factors scorecard
  - Diverged: the 8 CSFs are encoded as LLM rubric lenses feeding ranked Plant Intelligence insights (`src/lib/phase-engine/rubric.ts`), not a numeric scorecard UI — pending decision (FRD Open Question 6)
- [x] D-006: Recent activity feed
  - `src/lib/dashboard/service.ts` getRecentActivity() merges person activities, completed meetings, completed tasks
  - `src/components/dashboard/activity-feed.tsx`
- [x] D-007: Quick actions (add person, schedule meeting)
  - `src/components/dashboard/quick-actions.tsx` (Add Person, Schedule Meeting, View Tasks, View Pipeline)
- [ ] D-008: Data aggregation from all features
  - Partial: aggregates people, tasks, and meetings (`src/lib/dashboard/service.ts`); no giving/financial or team-staffing metrics
- [x] D-009: Read-only display (viewing only, not data entry)
  - `src/app/(dashboard)/dashboard/page.tsx` renders only metric cards, activity feed, and navigation links

## Should Have

- [ ] D-010: Growth velocity (rate and projections)
- [ ] D-011: Vision Meeting trends chart
  - Per-meeting attendance trend charts exist (`src/app/(dashboard)/meetings/[id]/analytics/page.tsx`); nothing on the dashboard itself
- [ ] D-012: Follow-up metrics (48-hour completion rate)
  - Follow-up signals computed only as Plant Intelligence facts (`src/lib/phase-engine/signals/build-fact-snapshot.ts`); not displayed on the dashboard
- [ ] D-013: Ministry team readiness (Phase 2+)
  - Team health/staffing views exist under `/teams` (`src/app/(dashboard)/teams/health/page.tsx`); nothing on the dashboard
- [ ] D-014: Milestone timeline
- [ ] D-015: Alert badges (items needing attention)
  - Partial: only the Overdue Tasks metric card switches to a warning variant; no other threshold alerts from the FRD Alerts table
- [ ] D-016: Wiki integration ("How to improve" links)
  - Diverged: wiki links surface inside Plant Intelligence insight cards on `/phase`, not as dashboard "How to improve" links — pending decision (FRD Open Question 6)
- [ ] D-017: Phase detail drill-down
  - Diverged: the drill-down is the `/phase` Plant Intelligence surface (Focus panel, phase control, self-attestations), not an expandable dashboard view — pending decision (FRD Open Question 6)
- [ ] D-018: Coach dashboard (multi-planter overview)
  - Admin oversight surfaces exist (`/oversight`, `/oversight/health`) for sending_church_admin/network_admin only; no coach-facing dashboard — pending decision (FRD Open Question 7)

## Nice to Have

- [ ] D-019: Dashboard customization (user-configurable metrics)
- [ ] D-020: Network comparison (compare to network averages)
- [ ] D-021: Data export for reports
- [ ] D-022: Weekly email reports (automated summaries)
- [ ] D-023: Push notifications for critical metrics
- [ ] D-024: Historical trends (long-term analysis)
