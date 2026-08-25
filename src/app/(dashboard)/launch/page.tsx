// ============================================================================
// /launch — the plant's Launch Sunday surface (LS-004).
//
// A SERVER component. It reads the launch entity, its readiness, its journal and
// its milestone history, and hands every one of them down as props; the only
// client code on this page is the forms, the date card's disclosure and the tab
// strip, and none of them owns server data
// (memory/contracts/data-patterns.md).
//
// HOW THE PAGE IS ORGANISED, and why (design pass, 2026-08-08):
//
//   1. the DATE, with its controls folded into it. Naming a launch date happens
//      once and moving it almost never, so the change-date form and the date
//      journal open from the date card rather than standing permanently between
//      the countdown and the plant's actual work.
//   2. the DAY ITSELF, once it exists — the record, and the form that records or
//      corrects it. On launch day this is the most important thing on the page,
//      so it is never behind a tab.
//   3. TASKS and HISTORY, as tabs. Tasks is the readiness board. History is what
//      the plant has DONE — who closed which milestone and when, interleaved
//      with the outcome being recorded or corrected. The date journal is NOT
//      here: it belongs with the control that writes it (see 1).
//
// THE COUNTDOWN IS COMPUTED ONCE, HERE, by `daysUntilTarget` — the same helper
// the phase-engine fact snapshot and the oversight listing use. Two things
// follow, and both are deliberate:
//
//   * no child reads the clock. A client component that called `new Date()`
//     would render one number on the server and another after hydration
//     (React #418), and a second day-diff would be free to floor a day away —
//     which is bug #338, shipped twice already (#303, then the signal layer).
//   * the page is `force-dynamic`: a countdown cached at build time is a
//     countdown that is wrong tomorrow.
//
// WHO SEES WHAT (LS-007):
//   planter      everything, including the schedule/postpone and outcome forms.
//   team member  the countdown, both tabs, and the readiness checkboxes — task
//                and milestone completion follow normal task rules — but no
//                date controls and no outcome form. The date journal is still
//                readable, from the same disclosure, because "when did this day
//                move" is a fair question for the people preparing for it. The
//                server enforces the same split; this page only stops offering
//                what would be refused.
//   oversight    not here at all. They have `/oversight/plants`, which reads
//                the same launch date.
// ============================================================================

import { redirect } from "next/navigation";

import type { LaunchStatus } from "@/db/schema/launch";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas } from "@/components/layout/page-frame";
import { LaunchDateCard } from "@/components/launch/launch-date-card";
import { LaunchHistory } from "@/components/launch/launch-history";
import { LaunchJournal } from "@/components/launch/launch-journal";
import { LaunchTabs } from "@/components/launch/launch-tabs";
import { MilestoneBoard } from "@/components/launch/milestone-board";
import { OutcomeForm } from "@/components/launch/outcome-form";
import {
  buildLaunchHistory,
  launchDateEvents,
} from "@/components/launch/presentation";
import { ScheduleLaunchForm } from "@/components/launch/schedule-launch-form";
import { verifySession } from "@/lib/auth/session";
import { daysUntilTarget } from "@/lib/launch/countdown";
import { getLaunchJournalEntries } from "@/lib/launch/journal";
import {
  convergeLaunchReadiness,
  getLaunchMilestoneHistory,
} from "@/lib/launch/milestones";
import { canEditOutcome, canRecordOutcome } from "@/lib/launch/outcome";
import { getLaunchForChurch } from "@/lib/launch/queries";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { isChurchLevelUser } from "@/lib/auth/tenancy";

export const dynamic = "force-dynamic";

/**
 * What the readiness tab says when it has no rows to draw — one honest sentence
 * per status, rather than one sentence stretched over four different facts
 * (#614).
 *
 * A TOTAL MAP, so the compiler names this copy the day a fifth status is added.
 * The bug this replaces was a boolean: "naming Launch Sunday seeds it" is true
 * only while no day is named, and it was being shown to a `scheduled` plant
 * whose seed had failed thirteen days earlier, and would have been shown to a
 * `completed` one as advice about a day it had already launched.
 *
 * Only `scheduled` and `postponed` promise a retry, because they are the only
 * two `convergeLaunchReadiness` tries for.
 */
const READINESS_EMPTY_STATE = {
  planning: {
    title: "No readiness list yet",
    detail: "Naming Launch Sunday seeds it from the Launch Playbook.",
  },
  scheduled: {
    title: "We could not build your readiness list",
    detail:
      "Reload the page to try again. If it stays empty, tell us with the Feedback button.",
  },
  postponed: {
    title: "We could not build your readiness list",
    detail:
      "Reload the page to try again. If it stays empty, tell us with the Feedback button.",
  },
  completed: {
    title: "No readiness list was kept for this launch",
    detail: "The day itself is on the record above.",
  },
} satisfies Record<LaunchStatus, { title: string; detail: string }>;

export const metadata = {
  title: "Launch Sunday",
  description:
    "The countdown, your readiness milestones, and the record of the day.",
};

export default async function LaunchPage() {
  const { user } = await verifySession();

  // An oversight tenancy has its own surfaces; a plant's launch page is the
  // plant's. Anyone without a church has no launch to show. `isChurchLevelUser`
  // is the same predicate `recordMilestone` refuses oversight with, so what
  // this page renders and what its actions accept cannot disagree.
  if (!isChurchLevelUser(user) || !user.churchId) {
    redirect("/dashboard");
  }

  const churchId = user.churchId;
  // THE CAPABILITY TABLE, not the seat shape (#659). `isPlantOwner` resolves to
  // the same answer today — `launch.schedule` is OWNER_ONLY on a plant — but it
  // is a second spelling of one question, in a file that already asks
  // `holdsSeatFor` for the sibling verb below. The three affordances gated on
  // this are the three writes `requireChurchSession("launch.schedule")`
  // refuses, so the question the screen asks is now the string the server
  // answers.
  const canSchedule = holdsSeatFor(user, "launch.schedule");
  const launch = await getLaunchForChurch(churchId);

  // ONE clock read for the whole render, so every number on the page is about
  // the same instant.
  const now = new Date();
  const daysUntil = daysUntilTarget(launch?.targetDate ?? null, now);

  // THE READINESS READ REPAIRS WHAT IT READS (#614). A launch whose seed failed
  // keeps its date and loses its list, and the schedule form cannot re-seed it —
  // both its buttons stay disabled until a DIFFERENT day is picked. So the retry
  // lives here, on the visit that would otherwise show the damage. It is safe on
  // every render: the seed is idempotent by unique index, and this page is
  // `force-dynamic` (see the header), so nothing caches the write away.
  const [readiness, journal, milestoneHistory] = launch
    ? await Promise.all([
        convergeLaunchReadiness(launch, user.id),
        getLaunchJournalEntries(launch.id, churchId),
        getLaunchMilestoneHistory(launch.id, churchId),
      ])
    : [null, [], []];

  const status = launch?.status ?? "planning";
  const showOutcomeForm = canSchedule && canRecordOutcome(launch, now);
  // A recorded outcome stays correctable by the planter, with every correction
  // journalled (LS-006, ruled 2026-08-04) — the record is the plant's own
  // account of its day, and getting a headcount right on Monday is normal.
  const showOutcomeEditor = canSchedule && canEditOutcome(launch);
  // A completed launch's date is frozen (`recordLaunchOutcome` is what freezes
  // it), so the planter is offered no date control once the day is recorded.
  const canChangeDate = canSchedule && status !== "completed";

  const history = buildLaunchHistory(milestoneHistory, journal);
  const hasDateHistory = launchDateEvents(journal).length > 0;
  const hasReadiness = !!readiness && readiness.totalCount > 0;
  // "Has a day been named?" — which is `status !== "planning"` and nothing else,
  // because `launches_target_date_check` makes `planning` the only status a null
  // `target_date` is legal for. It is deliberately NOT `launchExpectsReadiness`:
  // that predicate answers "should we SEED?", and the two part company on
  // `completed`, where a day was named and nothing should be seeded (#614).
  const dayIsNamed = status !== "planning";

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Launch" }]} />

      <PageCanvas context="none" contentFocusTarget scrollLayout="flow">
        <div
          data-slot="launch-sibling-surfaces"
          className="mx-auto min-h-full max-w-4xl space-y-6"
        >
          {/* ---- The date, and the controls that change it -------------- */}
          <LaunchDateCard
            targetDate={launch?.targetDate ?? null}
            status={status}
            daysUntil={daysUntil}
            canChangeDate={canChangeDate}
            hasDateHistory={hasDateHistory}
            scheduleForm={
              canChangeDate ? (
                // `key` on the stored date: a saved change remounts the form
                // instead of leaving the planter's previous draft in the input.
                <ScheduleLaunchForm
                  key={launch?.targetDate ?? "unscheduled"}
                  targetDate={launch?.targetDate ?? null}
                  // The status, not just the day: a postponed launch can be
                  // re-committed to the SAME Sunday, which is a real write and
                  // the one case where an unchanged date still has something to
                  // save.
                  status={status}
                />
              ) : undefined
            }
            dateHistory={<LaunchJournal entries={journal} />}
          />

          {/* ---- The outcome, once it exists ---------------------------- */}
          {launch?.outcomeRecordedAt && (
            <section className="bg-card rounded-xl border p-6 shadow-sm">
              <h2 className="text-xl font-semibold tracking-tight">
                The day itself
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">
                    Attendance
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {launch.attendanceCount ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">
                    Decisions and responses
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {launch.decisionsCount ?? "—"}
                  </p>
                </div>
              </div>
              {launch.outcomeNotes && (
                <p className="mt-4 text-sm whitespace-pre-line">
                  {launch.outcomeNotes}
                </p>
              )}
              {launch.captureTheDay && (
                <div className="mt-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">
                    Capturing the day
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-line">
                    {launch.captureTheDay}
                  </p>
                </div>
              )}
            </section>
          )}

          {/* ---- Recording it, on the day ------------------------------- */}
          {showOutcomeForm && <OutcomeForm />}

          {/* ---- Correcting it afterwards ------------------------------- */}
          {showOutcomeEditor && launch && (
            // `key` on what is stored: a saved correction remounts the form on
            // the server's values instead of leaving the planter's old draft in
            // the inputs (memory/contracts/data-patterns.md).
            <OutcomeForm
              key={`${launch.attendanceCount}|${launch.decisionsCount}|${launch.outcomeNotes ?? ""}|${launch.captureTheDay ?? ""}`}
              mode="edit"
              initial={{
                attendanceCount: launch.attendanceCount,
                decisionsCount: launch.decisionsCount,
                outcomeNotes: launch.outcomeNotes,
                captureTheDay: launch.captureTheDay,
              }}
            />
          )}

          {/* ---- The work, and the record of it -------------------------
              `dayIsNamed` is the third arm, and it is what makes the section
              unhideable once a day exists (#614). The empty state below used to
              live INSIDE a guard that required readiness or history, so the one
              plant that needed the explanation — a scheduled launch with zero
              milestone rows — was the one plant the explanation could never
              reach. A page that says "work the readiness list" over a hidden
              list is a page the planter reads as broken. */}
          {(hasReadiness || history.length > 0 || dayIsNamed) && (
            <LaunchTabs
              historyCount={history.length}
              tasks={
                hasReadiness && readiness ? (
                  <MilestoneBoard
                    readiness={readiness}
                    // AS-020, and NARROWER THAN IT LOOKS. This was `canEdit`
                    // hardcoded true. `launch.milestone` is SEATED, not
                    // Owner-only — LS-007 split it from `launch.schedule` so
                    // milestone ticks follow ordinary task rules — so a plant
                    // Member still ticks, which is the point. What the
                    // capability adds is the refusal the hardcoded `true` could
                    // not make: a coach and an oversight account hold no seat
                    // here, and `setLaunchTaskCompleteAction` says so anyway.
                    canEdit={holdsSeatFor(user, "launch.milestone")}
                  />
                ) : (
                  <div className="bg-card rounded-xl border border-dashed p-6 text-center shadow-sm">
                    <p className="font-medium">
                      {READINESS_EMPTY_STATE[status].title}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {READINESS_EMPTY_STATE[status].detail}
                    </p>
                  </div>
                )
              }
              history={<LaunchHistory entries={history} />}
            />
          )}
        </div>
      </PageCanvas>
    </>
  );
}
