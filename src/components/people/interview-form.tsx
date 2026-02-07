"use client";

import { createInterviewAction } from "@/app/(dashboard)/people/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { InterviewResult, InterviewStatus, Person } from "@/db/schema";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface InterviewFormProps {
  person: Person;
  onSuccess?: () => void;
}

interface CriterionState {
  status: InterviewStatus | null;
  notes: string;
}

const CRITERIA = [
  {
    key: "maturity",
    label: "Maturity",
    question: "Are they spiritually and emotionally mature?",
  },
  {
    key: "gifted",
    label: "Gifted",
    question: "Do they bring a needed skill set?",
  },
  {
    key: "chemistry",
    label: "Chemistry",
    question: "Is there good chemistry with leadership?",
  },
  {
    key: "rightReasons",
    label: "Right Reasons",
    question: "Are they coming for the right reasons?",
  },
  {
    key: "season",
    label: "Season of Life",
    question: "Are they in a stable season of life?",
  },
] as const;

type CriterionKey = (typeof CRITERIA)[number]["key"];

const STATUS_OPTIONS: {
  value: InterviewStatus;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "pass",
    label: "Pass",
    icon: <Check className="h-4 w-4 text-green-600" />,
  },
  {
    value: "fail",
    label: "Fail",
    icon: <X className="h-4 w-4 text-red-600" />,
  },
  {
    value: "concern",
    label: "Concern",
    icon: <AlertTriangle className="h-4 w-4 text-yellow-600" />,
  },
];

const RESULT_OPTIONS: { value: InterviewResult; label: string }[] = [
  { value: "qualified", label: "Qualified" },
  { value: "qualified_with_notes", label: "Qualified with Notes" },
  { value: "not_qualified", label: "Not Qualified" },
  { value: "follow_up", label: "Follow-up Needed" },
];

function StatusSelector({
  value,
  onChange,
  disabled,
}: {
  value: InterviewStatus | null;
  onChange: (status: InterviewStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            "hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
            value === option.value
              ? "bg-muted ring-primary ring-2"
              : "border-input bg-background hover:border-primary/50 border"
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function InterviewForm({ person, onSuccess }: InterviewFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [criteria, setCriteria] = useState<
    Record<CriterionKey, CriterionState>
  >({
    maturity: { status: null, notes: "" },
    gifted: { status: null, notes: "" },
    chemistry: { status: null, notes: "" },
    rightReasons: { status: null, notes: "" },
    season: { status: null, notes: "" },
  });
  const [overallResult, setOverallResult] =
    useState<InterviewResult>("qualified");
  const [nextSteps, setNextSteps] = useState("");
  const [interviewDate, setInterviewDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  // Check if person has attended a Vision Meeting (is at least 'attendee')
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
  const attendeeIndex = statusOrder.indexOf("attendee");
  const showWarning = currentStatusIndex < attendeeIndex;

  // Check if all criteria have a status selected
  const allStatusesFilled = Object.values(criteria).every(
    (c) => c.status !== null
  );

  const updateStatus = (key: CriterionKey, status: InterviewStatus) => {
    setCriteria((prev) => ({
      ...prev,
      [key]: { ...prev[key], status },
    }));
  };

  const updateNotes = (key: CriterionKey, notes: string) => {
    setCriteria((prev) => ({
      ...prev,
      [key]: { ...prev[key], notes },
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allStatusesFilled) return;

    startTransition(async () => {
      const result = await createInterviewAction(person.id, {
        interviewDate,
        maturityStatus: criteria.maturity.status!,
        maturityNotes: criteria.maturity.notes || undefined,
        giftedStatus: criteria.gifted.status!,
        giftedNotes: criteria.gifted.notes || undefined,
        chemistryStatus: criteria.chemistry.status!,
        chemistryNotes: criteria.chemistry.notes || undefined,
        rightReasonsStatus: criteria.rightReasons.status!,
        rightReasonsNotes: criteria.rightReasons.notes || undefined,
        seasonStatus: criteria.season.status!,
        seasonNotes: criteria.season.notes || undefined,
        overallResult,
        nextSteps: nextSteps || undefined,
      });

      if (result.success) {
        toast.success("Interview recorded", {
          description: "Person has been advanced to Interviewed status.",
        });
        onSuccess?.();
        router.push(`/people/${person.id}/assessments?tab=interviews`);
      } else {
        toast.error("Failed to record interview", {
          description: result.error,
        });
      }
    });
  };

  // Count statuses for summary
  const filledCount = Object.values(criteria).filter(
    (c) => c.status !== null
  ).length;
  const passCount = Object.values(criteria).filter(
    (c) => c.status === "pass"
  ).length;
  const concernCount = Object.values(criteria).filter(
    (c) => c.status === "concern"
  ).length;
  const failCount = Object.values(criteria).filter(
    (c) => c.status === "fail"
  ).length;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {showWarning && (
        <Alert variant="default" className="border-yellow-500/50 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            This person hasn&apos;t attended a Vision Meeting yet. You can still
            record the interview, but typically interviews happen after
            attendance.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="interviewDate">Interview Date</Label>
        <Input
          id="interviewDate"
          type="date"
          value={interviewDate}
          onChange={(e) => setInterviewDate(e.target.value)}
          disabled={isPending}
          className="w-48"
        />
      </div>

      <div className="space-y-6">
        {CRITERIA.map((criterion, index) => (
          <div
            key={criterion.key}
            className="bg-card space-y-4 rounded-lg border p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-semibold">
                  {index + 1}. {criterion.label}
                </h4>
                <p className="text-muted-foreground text-sm">
                  {criterion.question}
                </p>
              </div>
            </div>

            <StatusSelector
              value={criteria[criterion.key].status}
              onChange={(status) => updateStatus(criterion.key, status)}
              disabled={isPending}
            />

            <div className="space-y-2">
              <Label htmlFor={`${criterion.key}-notes`} className="text-sm">
                Notes
              </Label>
              <Textarea
                id={`${criterion.key}-notes`}
                placeholder="Add notes..."
                value={criteria[criterion.key].notes}
                onChange={(e) => updateNotes(criterion.key, e.target.value)}
                disabled={isPending}
                className="min-h-[60px]"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="bg-muted/50 space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Summary: </span>
            {allStatusesFilled ? (
              <>
                <span className="font-medium">{passCount} Pass</span>
                {concernCount > 0 && (
                  <span className="ml-2 font-medium text-yellow-600">
                    {concernCount} Concern
                  </span>
                )}
                {failCount > 0 && (
                  <span className="ml-2 font-medium text-red-600">
                    {failCount} Fail
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">
                {filledCount}/5 criteria evaluated
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="overallResult">Overall Assessment</Label>
          <Select
            value={overallResult}
            onValueChange={(v) => setOverallResult(v as InterviewResult)}
            disabled={isPending}
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESULT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nextSteps">Next Steps</Label>
          <Textarea
            id="nextSteps"
            placeholder="Recommended next steps..."
            value={nextSteps}
            onChange={(e) => setNextSteps(e.target.value)}
            disabled={isPending}
            className="min-h-[80px]"
          />
        </div>
      </div>

      <div className="flex justify-end border-t pt-6">
        <Button type="submit" disabled={isPending || !allStatusesFilled}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Interview
        </Button>
      </div>
    </form>
  );
}
