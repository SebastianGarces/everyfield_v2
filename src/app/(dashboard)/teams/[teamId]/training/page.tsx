import { notFound, redirect } from "next/navigation";

import { TrainingTab } from "@/components/ministry-teams/training-tab";
import { db } from "@/db";
import { recordCorrections } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import {
  getTeam,
  getTrainingMatrix,
  listTrainingPrograms,
} from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

export default async function TeamTrainingPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { user } = await verifySession();
  const { teamId } = await params;

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const team = await getTeam(user.churchId, teamId);

  if (!team) {
    notFound();
  }

  const [programs, trainingMatrix] = await Promise.all([
    listTrainingPrograms(user.churchId, teamId),
    getTrainingMatrix(user.churchId, teamId),
  ]);

  const history = holdsSeatFor(user, "teams.write")
    ? await db
        .select({
          id: recordCorrections.id,
          correctedAt: recordCorrections.correctedAt,
          entityType: recordCorrections.entityType,
          before: recordCorrections.before,
          after: recordCorrections.after,
        })
        .from(recordCorrections)
        .where(
          and(
            eq(recordCorrections.churchId, user.churchId),
            sql`(
    (${recordCorrections.entityType} = 'training_program' AND ${recordCorrections.entityId} IN (SELECT id FROM training_programs WHERE church_id = ${user.churchId} AND (team_id = ${teamId} OR team_id IS NULL))) OR
    (${recordCorrections.entityType} = 'training_completion' AND ${recordCorrections.entityId} IN (SELECT c.id FROM training_completions c JOIN training_programs p ON p.id = c.training_program_id AND p.church_id = c.church_id WHERE c.church_id = ${user.churchId} AND (p.team_id = ${teamId} OR p.team_id IS NULL)))
  )`
          )
        )
        .orderBy(recordCorrections.correctedAt)
    : [];
  return (
    <>
      <TrainingTab
        teamId={teamId}
        programs={programs}
        matrix={trainingMatrix.rows}
      />
      {history.length > 0 && (
        <details className="mt-6 rounded border p-3">
          <summary className="cursor-pointer">
            Training correction history ({history.length})
          </summary>
          {history.map((entry) => (
            <div key={entry.id} className="mt-3 border-t pt-3 text-sm">
              <p>
                {entry.correctedAt.toLocaleString("en-US", { timeZone: "UTC" })}{" "}
                UTC
              </p>
              {entry.entityType === "training_completion" ? (
                <p>
                  Completion corrected to incomplete; the original completion is
                  retained.
                </p>
              ) : (
                ["name", "description", "is_required"].map((field) => (
                  <p key={field}>
                    <span className="capitalize">
                      {field.replaceAll("_", " ")}
                    </span>
                    :{" "}
                    {String(
                      (entry.before as Record<string, unknown>)[field] ?? "—"
                    )}{" "}
                    →{" "}
                    {String(
                      (entry.after as Record<string, unknown>)[field] ?? "—"
                    )}
                  </p>
                ))
              )}
            </div>
          ))}
        </details>
      )}
    </>
  );
}
