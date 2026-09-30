"use client";

import { correctPersonRecordAction } from "@/app/(dashboard)/people/correction-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PersonRecordKind } from "@/lib/people/corrections";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const options: Record<string, string[]> = {
  commitment_type: ["core_group", "launch_team"],
  overall_result: [
    "qualified",
    "qualified_with_notes",
    "not_qualified",
    "follow_up",
  ],
};
const excluded = new Set([
  "id",
  "church_id",
  "person_id",
  "created_at",
  "assessed_by",
  "interviewed_by",
  "total_score",
  "document_url",
]);
export function RecordCorrectionForm({
  personId,
  kind,
  recordId,
  version,
  record,
}: {
  personId: string;
  kind: PersonRecordKind;
  recordId: string;
  version: string;
  record: Record<string, unknown>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const input: Record<string, unknown> = {};
        for (const [key, value] of fields) {
          const name = key.replace(/_([a-z])/g, (_, letter: string) =>
            letter.toUpperCase()
          );
          input[name] = key.endsWith("_score")
            ? Number(value)
            : value || undefined;
        }
        startTransition(async () => {
          const result = await correctPersonRecordAction(
            personId,
            kind,
            recordId,
            version,
            input
          );
          if (!result.success) {
            setError(result.error ?? "Unable to save correction");
            return;
          }
          router.push(
            `/people/${personId}/assessments?tab=${kind === "assessment" ? "assessments" : kind === "interview" ? "interviews" : "commitments"}`
          );
          router.refresh();
        });
      }}
    >
      <p className="text-muted-foreground text-sm">
        Save a correction to this record. Previous values and the editor are
        retained in edit history. This does not change the person&apos;s
        pipeline stage.
      </p>
      {Object.entries(record)
        .filter(([key]) => !excluded.has(key))
        .map(([key, value]) => {
          const label = key.replaceAll("_", " ");
          const choices =
            options[key] ??
            (key.endsWith("_status") ? ["pass", "fail", "concern"] : undefined);
          return (
            <div key={key} className="space-y-2">
              <Label htmlFor={key} className="capitalize">
                {label}
              </Label>
              {choices ? (
                <select
                  id={key}
                  name={key}
                  defaultValue={String(value ?? "")}
                  disabled={pending}
                  className="border-input bg-background h-10 w-full cursor-pointer rounded-md border px-3"
                >
                  {choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              ) : key.endsWith("notes") || key === "next_steps" ? (
                <Textarea
                  id={key}
                  name={key}
                  defaultValue={String(value ?? "")}
                  disabled={pending}
                />
              ) : (
                <Input
                  id={key}
                  name={key}
                  defaultValue={String(value ?? "")}
                  type={
                    key.endsWith("_date")
                      ? "date"
                      : key.endsWith("_score")
                        ? "number"
                        : "text"
                  }
                  min={key.endsWith("_score") ? 1 : undefined}
                  max={key.endsWith("_score") ? 5 : undefined}
                  disabled={pending}
                  required={key.endsWith("_date") || key.endsWith("_score")}
                />
              )}
            </div>
          );
        })}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={pending} type="submit">
          {pending ? "Saving…" : "Save correction"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => router.back()}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
