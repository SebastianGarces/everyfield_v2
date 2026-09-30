import { AssessmentEntryShell } from "@/components/people/assessment-entry-shell";
import { RecordCorrectionForm } from "@/components/people/record-correction-form";
import {
  getPersonRecordCorrection,
  personRecordKinds,
  type PersonRecordKind,
} from "@/lib/people/corrections";
import { verifySession } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { listRecordCorrections } from "@/lib/corrections/history";
import { z } from "zod";

export default async function CorrectionPage({
  params,
}: {
  params: Promise<{ id: string; kind: string; recordId: string }>;
}) {
  const { id, kind, recordId } = await params;
  if (
    !personRecordKinds.includes(kind as PersonRecordKind) ||
    !z.string().uuid().safeParse(id).success ||
    !z.string().uuid().safeParse(recordId).success
  )
    notFound();
  const { user } = await verifySession();
  if (!user.churchId) notFound();
  const correction = await getPersonRecordCorrection(
    user.churchId,
    id,
    kind as PersonRecordKind,
    recordId
  );
  if (!correction) notFound();
  const history = await listRecordCorrections(user.churchId, kind, recordId);
  return (
    <AssessmentEntryShell
      personId={id}
      backTab={
        kind === "assessment"
          ? "assessments"
          : kind === "interview"
            ? "interviews"
            : "commitments"
      }
      title={`Correct ${kind}`}
      renderForm={() => (
        <>
          <RecordCorrectionForm
            personId={id}
            kind={kind as PersonRecordKind}
            recordId={recordId}
            {...correction}
          />
          <section className="mt-8 space-y-3">
            <h2 className="text-lg font-semibold">Edit history</h2>
            {history.length === 0 ? (
              <p>No corrections yet.</p>
            ) : (
              history.map((entry) => (
                <details key={entry.id} className="rounded-md border p-3">
                  <summary className="cursor-pointer">
                    {entry.correctedAt.toLocaleString("en-US", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC · {entry.correctedByName ?? "Former editor"}
                  </summary>
                  <dl className="mt-3 space-y-2 text-sm">
                    {Object.entries(entry.after as Record<string, unknown>)
                      .filter(
                        ([field, value]) =>
                          ![
                            "id",
                            "church_id",
                            "person_id",
                            "created_at",
                            "assessed_by",
                            "interviewed_by",
                            "document_url",
                          ].includes(field) &&
                          JSON.stringify(value) !==
                            JSON.stringify(
                              (entry.before as Record<string, unknown>)[field]
                            )
                      )
                      .map(([field, value]) => (
                        <div key={field}>
                          <dt className="font-medium capitalize">
                            {field.replaceAll("_", " ")}
                          </dt>
                          <dd>
                            {String(
                              (entry.before as Record<string, unknown>)[
                                field
                              ] ?? "—"
                            )}{" "}
                            → {String(value ?? "—")}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </details>
              ))
            )}
          </section>
        </>
      )}
    />
  );
}
