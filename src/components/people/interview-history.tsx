"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Interview, InterviewResult, InterviewStatus } from "@/db/schema";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import { useState } from "react";

interface InterviewHistoryProps {
  interviews: Interview[];
}

const RESULT_LABELS: Record<
  InterviewResult,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  qualified: { label: "Qualified", variant: "default" },
  qualified_with_notes: { label: "Qualified with Notes", variant: "secondary" },
  not_qualified: { label: "Not Qualified", variant: "destructive" },
  follow_up: { label: "Follow-up Needed", variant: "outline" },
};

const STATUS_DISPLAY: Record<
  InterviewStatus,
  { icon: React.ReactNode; label: string; className: string }
> = {
  pass: {
    icon: <Check className="h-4 w-4" />,
    label: "Pass",
    className: "text-green-600 bg-green-50",
  },
  fail: {
    icon: <X className="h-4 w-4" />,
    label: "Fail",
    className: "text-red-600 bg-red-50",
  },
  concern: {
    icon: <AlertTriangle className="h-4 w-4" />,
    label: "Concern",
    className: "text-yellow-600 bg-yellow-50",
  },
};

const CRITERIA_LABELS = {
  maturity: "Maturity",
  gifted: "Gifted",
  chemistry: "Chemistry",
  rightReasons: "Right Reasons",
  season: "Season of Life",
};

function CriterionRow({
  label,
  status,
  notes,
}: {
  label: string;
  status: InterviewStatus;
  notes: string | null;
}) {
  const display = STATUS_DISPLAY[status];

  return (
    <div className="flex items-start gap-3 py-2">
      <div
        className={cn(
          "flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium",
          display.className
        )}
      >
        {display.icon}
        <span>{display.label}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        {notes && (
          <p className="text-muted-foreground mt-0.5 text-sm">{notes}</p>
        )}
      </div>
    </div>
  );
}

function InterviewCard({
  interview,
  isLatest,
}: {
  interview: Interview;
  isLatest: boolean;
}) {
  const [isOpen, setIsOpen] = useState(isLatest);

  const formattedDate = new Date(interview.interviewDate).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );

  const resultInfo = RESULT_LABELS[interview.overallResult];

  // Count statuses for summary
  const statuses = [
    interview.maturityStatus,
    interview.giftedStatus,
    interview.chemistryStatus,
    interview.rightReasonsStatus,
    interview.seasonStatus,
  ];
  const passCount = statuses.filter((s) => s === "pass").length;
  const concernCount = statuses.filter((s) => s === "concern").length;
  const failCount = statuses.filter((s) => s === "fail").length;

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
            <Badge variant={resultInfo.variant}>{resultInfo.label}</Badge>
            <div>
              <p className="text-left font-medium">{formattedDate}</p>
              <p className="text-muted-foreground text-left text-sm">
                {passCount} Pass
                {concernCount > 0 && ` • ${concernCount} Concern`}
                {failCount > 0 && ` • ${failCount} Fail`}
                {isLatest && (
                  <Badge variant="secondary" className="ml-2">
                    Latest
                  </Badge>
                )}
              </p>
            </div>
          </div>

          <ChevronDown
            className={cn(
              "text-muted-foreground h-5 w-5 transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4 border-t px-4 py-4">
            <div className="divide-y">
              <CriterionRow
                label={CRITERIA_LABELS.maturity}
                status={interview.maturityStatus}
                notes={interview.maturityNotes}
              />
              <CriterionRow
                label={CRITERIA_LABELS.gifted}
                status={interview.giftedStatus}
                notes={interview.giftedNotes}
              />
              <CriterionRow
                label={CRITERIA_LABELS.chemistry}
                status={interview.chemistryStatus}
                notes={interview.chemistryNotes}
              />
              <CriterionRow
                label={CRITERIA_LABELS.rightReasons}
                status={interview.rightReasonsStatus}
                notes={interview.rightReasonsNotes}
              />
              <CriterionRow
                label={CRITERIA_LABELS.season}
                status={interview.seasonStatus}
                notes={interview.seasonNotes}
              />
            </div>

            {interview.nextSteps && (
              <div className="border-t pt-4">
                <h5 className="text-muted-foreground mb-1 text-sm font-medium">
                  Next Steps
                </h5>
                <p className="text-sm">{interview.nextSteps}</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function InterviewHistory({ interviews }: InterviewHistoryProps) {
  if (interviews.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {interviews.map((interview, index) => (
        <InterviewCard
          key={interview.id}
          interview={interview}
          isLatest={index === 0}
        />
      ))}
    </div>
  );
}
