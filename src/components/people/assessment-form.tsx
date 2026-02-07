"use client";

import { createAssessmentAction } from "@/app/(dashboard)/people/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Person } from "@/db/schema";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface AssessmentFormProps {
  person: Person;
  onSuccess?: () => void;
}

interface CriterionScore {
  score: number;
  notes: string;
}

const CRITERIA = [
  {
    key: "committed",
    label: "Committed",
    description: "Signed commitment, consistent attendance, faithful giving",
  },
  {
    key: "compelled",
    label: "Compelled",
    description: "Internally motivated by the vision, can articulate the why",
  },
  {
    key: "contagious",
    label: "Contagious",
    description: "Actively inviting others, growing their sphere of influence",
  },
  {
    key: "courageous",
    label: "Courageous",
    description: "Bold in action despite uncertainty, willing to sacrifice",
  },
] as const;

type CriterionKey = (typeof CRITERIA)[number]["key"];

const SCORE_LABELS = [
  { value: 1, label: "Rarely demonstrates" },
  { value: 2, label: "Sometimes demonstrates" },
  { value: 3, label: "Often demonstrates" },
  { value: 4, label: "Consistently demonstrates" },
  { value: 5, label: "Exemplary" },
];

function getScoreLabel(totalScore: number): string {
  if (totalScore >= 18) return "Excellent";
  if (totalScore >= 14) return "Strong";
  if (totalScore >= 10) return "Developing";
  return "Needs Growth";
}

function ScoreSelector({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (score: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      {SCORE_LABELS.map(({ value: score, label }) => (
        <button
          key={score}
          type="button"
          disabled={disabled}
          onClick={() => onChange(score)}
          className={cn(
            "h-10 w-10 rounded-full text-sm font-medium transition-colors",
            "hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50",
            value === score
              ? "bg-primary text-primary-foreground"
              : "border-input bg-background hover:border-primary/50 border"
          )}
          title={label}
        >
          {score}
        </button>
      ))}
    </div>
  );
}

export function AssessmentForm({ person, onSuccess }: AssessmentFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [scores, setScores] = useState<Record<CriterionKey, CriterionScore>>({
    committed: { score: 0, notes: "" },
    compelled: { score: 0, notes: "" },
    contagious: { score: 0, notes: "" },
    courageous: { score: 0, notes: "" },
  });
  const [assessmentDate, setAssessmentDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  // Check if person is at core_group or higher status
  const statusOrder = [
    "prospect",
    "attendee",
    "following_up",
    "interviewed",
    "committed",
    "core_group",
    "launch_team",
    "leader",
  ];
  const currentStatusIndex = statusOrder.indexOf(person.status);
  const coreGroupIndex = statusOrder.indexOf("core_group");
  const showWarning = currentStatusIndex < coreGroupIndex;

  const totalScore = Object.values(scores).reduce((sum, s) => sum + s.score, 0);
  const allScoresFilled = Object.values(scores).every((s) => s.score > 0);

  const updateScore = (key: CriterionKey, score: number) => {
    setScores((prev) => ({
      ...prev,
      [key]: { ...prev[key], score },
    }));
  };

  const updateNotes = (key: CriterionKey, notes: string) => {
    setScores((prev) => ({
      ...prev,
      [key]: { ...prev[key], notes },
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    startTransition(async () => {
      const result = await createAssessmentAction(person.id, {
        committedScore: scores.committed.score,
        committedNotes: scores.committed.notes || undefined,
        compelledScore: scores.compelled.score,
        compelledNotes: scores.compelled.notes || undefined,
        contagiousScore: scores.contagious.score,
        contagiousNotes: scores.contagious.notes || undefined,
        courageousScore: scores.courageous.score,
        courageousNotes: scores.courageous.notes || undefined,
        assessmentDate,
      });

      if (result.success) {
        toast.success("Assessment recorded", {
          description: `Total score: ${totalScore}/20 (${getScoreLabel(totalScore)})`,
        });
        onSuccess?.();
        router.push(`/people/${person.id}/assessments?tab=assessments`);
      } else {
        toast.error("Failed to record assessment", {
          description: result.error,
        });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {showWarning && (
        <Alert variant="default" className="border-yellow-500/50 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            4 C&apos;s assessments are typically for Core Group members and
            above. This person is currently at an earlier stage.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="assessmentDate">Assessment Date</Label>
        <Input
          id="assessmentDate"
          type="date"
          value={assessmentDate}
          onChange={(e) => setAssessmentDate(e.target.value)}
          disabled={isPending}
          className="w-48"
        />
      </div>

      <div className="space-y-8">
        {CRITERIA.map((criterion) => (
          <div
            key={criterion.key}
            className="bg-card space-y-4 rounded-lg border p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-semibold tracking-wide uppercase">
                  {criterion.label}
                </h4>
                <p className="text-muted-foreground text-sm">
                  {criterion.description}
                </p>
              </div>
              <div
                className={cn(
                  "text-2xl font-bold",
                  scores[criterion.key].score > 0
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                {scores[criterion.key].score > 0
                  ? scores[criterion.key].score
                  : "-"}
                /5
              </div>
            </div>

            <ScoreSelector
              value={scores[criterion.key].score}
              onChange={(score) => updateScore(criterion.key, score)}
              disabled={isPending}
            />

            <div className="space-y-2">
              <Label htmlFor={`${criterion.key}-notes`} className="text-sm">
                Notes
              </Label>
              <Textarea
                id={`${criterion.key}-notes`}
                placeholder={`Notes about ${criterion.label.toLowerCase()}...`}
                value={scores[criterion.key].notes}
                onChange={(e) => updateNotes(criterion.key, e.target.value)}
                disabled={isPending}
                className="min-h-[60px]"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t pt-6">
        <div className="text-lg">
          <span className="text-muted-foreground">Overall Score: </span>
          {allScoresFilled ? (
            <>
              <span className="text-primary font-bold">{totalScore}/20</span>
              <span className="text-muted-foreground ml-2">
                ({getScoreLabel(totalScore)})
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Select all scores</span>
          )}
        </div>

        <Button type="submit" disabled={isPending || !allScoresFilled}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Assessment
        </Button>
      </div>
    </form>
  );
}
