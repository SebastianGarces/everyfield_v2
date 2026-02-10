"use client";

import { createEvaluationAction } from "@/app/(dashboard)/vision-meetings/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MeetingEvaluation } from "@/db/schema";
import type { ActionResult } from "@/lib/vision-meetings/types";
import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

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

export function EvaluationForm({
  meetingId,
  meetingNumber,
}: EvaluationFormProps) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number>>({});

  const action = async (
    _prevState: ActionResult<MeetingEvaluation> | null,
    formData: FormData
  ) => {
    return createEvaluationAction(meetingId, formData);
  };

  const [state, formAction, isPending] = useActionState(action, null);

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state, router]);

  const totalScore =
    Object.values(scores).length === 8
      ? (Object.values(scores).reduce((a, b) => a + b, 0) / 8).toFixed(1)
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
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      key={score}
                      type="button"
                      onClick={() =>
                        setScores((prev) => ({ ...prev, [factor.key]: score }))
                      }
                      className="cursor-pointer p-1 transition-colors"
                    >
                      <Star
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
          disabled={isPending || Object.keys(scores).length < 8}
          className="cursor-pointer"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Evaluation
        </Button>
      </div>
    </form>
  );
}
