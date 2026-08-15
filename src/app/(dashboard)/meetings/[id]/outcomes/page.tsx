import { notFound, redirect } from "next/navigation";

import { ResponseSummary } from "@/components/meetings/response-summary";
import { verifySession } from "@/lib/auth/session";
import {
  getMeeting,
  getMeetingResponseBreakdown,
} from "@/lib/meetings/service";

export const dynamic = "force-dynamic";

interface OutcomesPageProps {
  params: Promise<{ id: string }>;
}

/**
 * VM-014 — the Outcomes tab.
 *
 * A plain server component: the breakdown is computed on the server and passed
 * down as props, so there is no client boundary and no server data in
 * `useState` (memory/contracts/data-patterns.md). Capture lives on the
 * Attendance tab, where the planter has the cards; this only reads.
 *
 * `getMeeting` runs first and its result is what `notFound()` rests on. The
 * breakdown query is church-scoped in its own WHERE, so it would return zeroes
 * for another church's meeting anyway — but a 404 and an empty state say
 * different things, and "this meeting is not yours" must never render as "no
 * cards yet".
 */
export default async function OutcomesPage({ params }: OutcomesPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const meeting = await getMeeting(user.churchId, id);
  if (!meeting) notFound();

  const breakdown = await getMeetingResponseBreakdown(user.churchId, id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ResponseSummary breakdown={breakdown} />
    </div>
  );
}
