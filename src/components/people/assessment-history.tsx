"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Assessment } from "@/db/schema";
import { cn } from "@/lib/utils";
import { ChevronDown, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";

interface AssessmentHistoryProps {
  assessments: Assessment[];
}

function getScoreLabel(totalScore: number): string {
  if (totalScore >= 18) return "Excellent";
  if (totalScore >= 14) return "Strong";
  if (totalScore >= 10) return "Developing";
  return "Needs Growth";
}

function getScoreColor(totalScore: number): string {
  if (totalScore >= 18) return "text-green-600";
  if (totalScore >= 14) return "text-blue-600";
  if (totalScore >= 10) return "text-yellow-600";
  return "text-red-600";
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-24 text-sm">{label}</span>
      <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full transition-all"
          style={{ width: `${(score / 5) * 100}%` }}
        />
      </div>
      <span className="w-8 text-right text-sm font-medium">{score}/5</span>
    </div>
  );
}

function AssessmentCard({
  assessment,
  previousAssessment,
  isLatest,
}: {
  assessment: Assessment;
  previousAssessment?: Assessment;
  isLatest: boolean;
}) {
  const [isOpen, setIsOpen] = useState(isLatest);

  const trend = previousAssessment
    ? assessment.totalScore - previousAssessment.totalScore
    : null;

  const formattedDate = new Date(assessment.assessmentDate).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "bg-card rounded-lg border",
          isLatest && "ring-primary/20 ring-2"
        )}
      >
        <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center justify-between p-4 transition-colors">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "text-2xl font-bold",
                getScoreColor(assessment.totalScore)
              )}
            >
              {assessment.totalScore}/20
            </div>
            <div>
              <p className="text-left font-medium">{formattedDate}</p>
              <p className="text-muted-foreground text-left text-sm">
                {getScoreLabel(assessment.totalScore)}
                {isLatest && (
                  <Badge variant="secondary" className="ml-2">
                    Latest
                  </Badge>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {trend !== null && trend !== 0 && (
              <div
                className={cn(
                  "flex items-center gap-1 text-sm font-medium",
                  trend > 0 ? "text-green-600" : "text-red-600"
                )}
              >
                {trend > 0 ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                {trend > 0 ? "+" : ""}
                {trend}
              </div>
            )}
            <ChevronDown
              className={cn(
                "text-muted-foreground h-5 w-5 transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4 border-t px-4 py-4">
            <div className="space-y-3">
              <ScoreBar score={assessment.committedScore} label="Committed" />
              <ScoreBar score={assessment.compelledScore} label="Compelled" />
              <ScoreBar score={assessment.contagiousScore} label="Contagious" />
              <ScoreBar score={assessment.courageousScore} label="Courageous" />
            </div>

            {(assessment.committedNotes ||
              assessment.compelledNotes ||
              assessment.contagiousNotes ||
              assessment.courageousNotes) && (
              <div className="space-y-3 border-t pt-4">
                <h5 className="text-muted-foreground text-sm font-medium">
                  Notes
                </h5>
                {assessment.committedNotes && (
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase">
                      Committed
                    </p>
                    <p className="text-sm">{assessment.committedNotes}</p>
                  </div>
                )}
                {assessment.compelledNotes && (
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase">
                      Compelled
                    </p>
                    <p className="text-sm">{assessment.compelledNotes}</p>
                  </div>
                )}
                {assessment.contagiousNotes && (
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase">
                      Contagious
                    </p>
                    <p className="text-sm">{assessment.contagiousNotes}</p>
                  </div>
                )}
                {assessment.courageousNotes && (
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase">
                      Courageous
                    </p>
                    <p className="text-sm">{assessment.courageousNotes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function AssessmentHistory({ assessments }: AssessmentHistoryProps) {
  if (assessments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {assessments.map((assessment, index) => (
        <AssessmentCard
          key={assessment.id}
          assessment={assessment}
          previousAssessment={assessments[index + 1]}
          isLatest={index === 0}
        />
      ))}
    </div>
  );
}
