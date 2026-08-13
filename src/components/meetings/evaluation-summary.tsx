import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star } from "lucide-react";
// The same list the form asks from and the same scale it offers — this file
// carried its own copy of both, so a ninth factor rated on the form would have
// been left off the summary of the planter's own scores. See
// src/lib/meetings/evaluation-factors.ts.
import {
  EVALUATION_QUALITY_FACTORS,
  RATINGS,
} from "@/lib/meetings/evaluation-factors";
import type { MeetingEvaluation } from "@/db/schema";

interface EvaluationSummaryProps {
  evaluation: MeetingEvaluation;
  /**
   * The meeting's display name, ALREADY DERIVED by the server page.
   *
   * Not `meetingNumber`: this component used to build a meeting out of
   * `{ type: "vision_meeting", meetingNumber }` and hand that to
   * `meetingDisplayTitle`, which fabricated a fact — the route has no type
   * gate, so an orientation or a team meeting reached by URL was headed
   * "Vision Meeting Evaluation". The page holds the real row, so it derives
   * the name once and this component only prints it.
   */
  title: string;
}

function ScoreStars({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5">
      {RATINGS.map((s) => (
        <Star
          key={s}
          className={`h-4 w-4 ${
            score >= s ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
          }`}
        />
      ))}
    </div>
  );
}

export function EvaluationSummary({
  evaluation,
  title,
}: EvaluationSummaryProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold">{title} Evaluation</h2>
        <div className="mt-2">
          <span className="text-4xl font-bold">{evaluation.totalScore}</span>
          <span className="text-muted-foreground text-xl">/5.0</span>
        </div>
      </div>

      <div className="grid gap-3">
        {EVALUATION_QUALITY_FACTORS.map((factor) => (
          <Card key={factor.key}>
            <CardContent className="flex items-center justify-between py-3">
              <span className="text-sm font-medium">{factor.label}</span>
              <div className="flex items-center gap-2">
                <ScoreStars score={evaluation[factor.key]} />
                <span className="w-6 text-right text-sm font-bold">
                  {evaluation[factor.key]}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {evaluation.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Improvement Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{evaluation.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
