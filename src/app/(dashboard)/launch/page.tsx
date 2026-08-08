// ============================================================================
// /launch — the plant's Launch Sunday surface (LS-004).
//
// A SERVER component. It reads the launch entity, its readiness and its
// journal, and hands every one of them down as props; the only client code on
// this page is the three forms, and they own nothing but their own inputs
// (memory/contracts/data-patterns.md).
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
//   team member  the countdown, the readiness list and its checkboxes — task
//                and milestone completion follow normal task rules — but no
//                date controls and no outcome form. The server enforces the
//                same split; this page only stops offering what would be
//                refused.
//   oversight    not here at all. They have `/oversight/plants`, which reads
//                the same launch date.
// ============================================================================

import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { LaunchJournal } from "@/components/launch/launch-journal";
import { MilestoneBoard } from "@/components/launch/milestone-board";
import { OutcomeForm } from "@/components/launch/outcome-form";
import {
  countdownFigure,
  countdownLabel,
  formatLaunchDay,
  launchStatusMeta,
} from "@/components/launch/presentation";
import { ScheduleLaunchForm } from "@/components/launch/schedule-launch-form";
import { Badge } from "@/components/ui/badge";
import { verifySession } from "@/lib/auth/session";
import { daysUntilTarget } from "@/lib/launch/countdown";
import { getLaunchJournalEntries } from "@/lib/launch/journal";
import { getLaunchReadiness } from "@/lib/launch/milestones";
import { canRecordOutcome } from "@/lib/launch/outcome";
import { getLaunchForChurch } from "@/lib/launch/queries";
import { CHURCH_LEVEL_ROLES } from "@/lib/auth/access";
import type { UserRole } from "@/db/schema";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Launch Sunday",
  description:
    "The countdown, your readiness milestones, and the record of the day.",
};

export default async function LaunchPage() {
  const { user } = await verifySession();

  // Oversight users have their own surfaces; a plant's launch page is the
  // plant's. Anyone without a church has no launch to show.
  if (!CHURCH_LEVEL_ROLES.includes(user.role as UserRole) || !user.churchId) {
    redirect("/dashboard");
  }

  const churchId = user.churchId;
  const isPlanter = user.role === "planter";
  const launch = await getLaunchForChurch(churchId);

  // ONE clock read for the whole render, so every number on the page is about
  // the same instant.
  const now = new Date();
  const daysUntil = daysUntilTarget(launch?.targetDate ?? null, now);

  const [readiness, journal] = launch
    ? await Promise.all([
        getLaunchReadiness(launch.id, churchId),
        getLaunchJournalEntries(launch.id),
      ])
    : [null, []];

  const status = launch?.status ?? "planning";
  const meta = launchStatusMeta(status);
  const figure = countdownFigure(daysUntil);
  const showOutcomeForm = isPlanter && canRecordOutcome(launch, now);

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Launch" }]} />

      <div className="p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* ---- The countdown ------------------------------------------ */}
          <div className="bg-card rounded-xl border p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">
                  Launch Sunday
                </h1>
                <p className="text-muted-foreground mt-1">{meta.description}</p>
              </div>
              <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
            </div>

            {launch?.targetDate ? (
              <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {figure && (
                  <p className="text-5xl font-bold tracking-tight">
                    {figure.value}
                    <span className="text-muted-foreground ml-2 text-lg font-normal">
                      {figure.unit}{" "}
                      {daysUntil !== null && daysUntil < 0 ? "ago" : "out"}
                    </span>
                  </p>
                )}
                <p className="text-lg">
                  {formatLaunchDay(launch.targetDate)}{" "}
                  <span className="text-muted-foreground">
                    &middot; {countdownLabel(daysUntil)}
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground mt-6">
                No date is set yet.{" "}
                {isPlanter
                  ? "Name the day below and your readiness list is created from the Launch Playbook."
                  : "Your planter names the day."}
              </p>
            )}
          </div>

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
                  <p className="text-2xl font-semibold">
                    {launch.attendanceCount ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">
                    Decisions and responses
                  </p>
                  <p className="text-2xl font-semibold">
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

          {/* ---- Scheduling (planter only) ------------------------------ */}
          {isPlanter && status !== "completed" && (
            // `key` on the stored date: a saved change remounts the form
            // instead of leaving the planter's previous draft in the input.
            <ScheduleLaunchForm
              key={launch?.targetDate ?? "unscheduled"}
              targetDate={launch?.targetDate ?? null}
            />
          )}

          {/* ---- Readiness ---------------------------------------------- */}
          {readiness && readiness.totalCount > 0 && (
            <MilestoneBoard readiness={readiness} canEdit />
          )}

          {/* ---- History ------------------------------------------------ */}
          <LaunchJournal entries={journal} />
        </div>
      </div>
    </>
  );
}
