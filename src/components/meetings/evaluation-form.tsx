"use client";

import { useActionState, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createEvaluationAction } from "@/app/(dashboard)/meetings/actions";
import type { ActionResult } from "@/lib/meetings/types";
import type { MeetingEvaluation } from "@/db/schema";

interface EvaluationFormProps {
  meetingId: string;
  meetingNumber: number;
}

const qualityFactors = [
  {
    key: "attendanceScore",
    label: "Great Attendance",
    description: "Core Group actively inviting",
  },
  {
    key: "locationScore",
    label: "Acceptable Location",
    description: "Easy to find, welcoming, distraction-free",
  },
  {
    key: "logisticsScore",
    label: "Great Logistics",
    description: "Room ready, AV tested, materials prepared",
  },
  {
    key: "agendaScore",
    label: "Clear Agenda",
    description: "Planned in detail, starts and ends on time",
  },
  {
    key: "vibeScore",
    label: "Great Vibe",
    description: "Warm, inviting, enthusiastic",
  },
  {
    key: "messageScore",
    label: "Compelling Message",
    description: "Clear vision presented effectively",
  },
  {
    key: "closeScore",
    label: "Strong Close",
    description: "Non-manipulative call to action",
  },
  {
    key: "nextStepsScore",
    label: "Clear Next Steps",
    description: "Dates and details communicated",
  },
];

/**
 * How many factors a complete evaluation carries.
 *
 * DERIVED, never the literal `8`. That number was written out three times — the
 * "is it complete" test, the divisor of the average and the submit button's
 * disabled test — so a ninth factor added to the array above would have
 * unlocked Save one factor early AND divided nine scores by eight, printing an
 * average the planter can see is wrong under a heading that says /5.0.
 */
const FACTOR_COUNT = qualityFactors.length;

/** The rating a star offers, low to high. */
const RATINGS = [1, 2, 3, 4, 5] as const;

export function EvaluationForm({
  meetingId,
  meetingNumber,
}: EvaluationFormProps) {
  const [scores, setScores] = useState<Record<string, number>>({});

  const action = async (
    _prevState: ActionResult<MeetingEvaluation> | null,
    formData: FormData
  ) => {
    return createEvaluationAction(meetingId, formData);
  };

  const [state, formAction, isPending] = useActionState(action, null);

  // No effect on success: `createEvaluationAction` revalidates the route, so
  // the server sends the next render. An effect that watched `state` and did
  // nothing sat here instead, which reads as a missing implementation rather
  // than as a deliberate absence.
  const rated = Object.values(scores);
  const isComplete = rated.length === FACTOR_COUNT;
  const totalScore = isComplete
    ? (rated.reduce((a, b) => a + b, 0) / FACTOR_COUNT).toFixed(1)
    : null;

  return (
    <form action={formAction} className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">
          Evaluate Vision Meeting #{meetingNumber}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Rate each quality factor from 1 (poor) to 5 (excellent).
        </p>
      </div>

      {state && !state.success && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {qualityFactors.map((factor) => (
          <Card key={factor.key}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">{factor.label}</Label>
                  <p className="text-muted-foreground text-xs">
                    {factor.description}
                  </p>
                </div>
                {/*
                  A rating group, named by its factor. Each star used to be a
                  <button> whose only child was an <svg>, so it had no
                  accessible name at all: a screen reader announced forty
                  unlabelled "button"s on this form and said nothing about which
                  score was chosen. `aria-pressed` carries the state the yellow
                  fill carries visually.
                */}
                <div
                  role="group"
                  aria-label={`${factor.label} rating`}
                  className="flex gap-1"
                >
                  {RATINGS.map((score) => (
                    <button
                      key={score}
                      type="button"
                      aria-label={`${score} out of ${RATINGS.length}`}
                      aria-pressed={scores[factor.key] === score}
                      onClick={() =>
                        setScores((prev) => ({ ...prev, [factor.key]: score }))
                      }
                      className="cursor-pointer p-1 transition-colors"
                    >
                      <Star
                        aria-hidden="true"
                        className={`h-6 w-6 ${
                          (scores[factor.key] ?? 0) >= score
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-gray-300"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="hidden"
                name={factor.key}
                value={scores[factor.key] ?? ""}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {totalScore && (
        <div className="py-2 text-center">
          <span className="text-3xl font-bold">{totalScore}</span>
          <span className="text-muted-foreground text-lg">/5.0</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="notes">Improvement Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          placeholder="What can be improved for the next meeting?"
          rows={3}
        />
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending || !isComplete}
          className="cursor-pointer"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Evaluation
        </Button>
      </div>
    </form>
  );
}
