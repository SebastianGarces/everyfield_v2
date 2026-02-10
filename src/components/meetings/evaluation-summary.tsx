import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star } from "lucide-react";
import type { MeetingEvaluation } from "@/db/schema";

interface EvaluationSummaryProps {
  evaluation: MeetingEvaluation;
  meetingNumber: number;
}

const qualityFactors = [
  { key: "attendanceScore" as const, label: "Great Attendance" },
  { key: "locationScore" as const, label: "Acceptable Location" },
  { key: "logisticsScore" as const, label: "Great Logistics" },
  { key: "agendaScore" as const, label: "Clear Agenda" },
  { key: "vibeScore" as const, label: "Great Vibe" },
  { key: "messageScore" as const, label: "Compelling Message" },
  { key: "closeScore" as const, label: "Strong Close" },
  { key: "nextStepsScore" as const, label: "Clear Next Steps" },
];

function ScoreStars({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`h-4 w-4 ${
            score >= s
              ? "fill-yellow-400 text-yellow-400"
              : "text-gray-300"
          }`}
        />
      ))}
    </div>
  );
}

export function EvaluationSummary({
  evaluation,
  meetingNumber,
}: EvaluationSummaryProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold">
          Vision Meeting #{meetingNumber} Evaluation
        </h2>
        <div className="mt-2">
          <span className="text-4xl font-bold">{evaluation.totalScore}</span>
          <span className="text-muted-foreground text-xl">/5.0</span>
        </div>
      </div>

      <div className="grid gap-3">
        {qualityFactors.map((factor) => (
          <Card key={factor.key}>
            <CardContent className="flex items-center justify-between py-3">
              <span className="text-sm font-medium">{factor.label}</span>
              <div className="flex items-center gap-2">
                <ScoreStars score={evaluation[factor.key]} />
                <span className="text-sm font-bold w-6 text-right">
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
