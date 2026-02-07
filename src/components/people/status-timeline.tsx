"use client";

import type { PersonStatus } from "@/lib/people/types";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface StatusTimelineProps {
  currentStatus: PersonStatus;
}

const STATUS_STEPS: { id: PersonStatus; label: string }[] = [
  { id: "prospect", label: "Prospect" },
  { id: "attendee", label: "Attendee" },
  { id: "following_up", label: "Following Up" },
  { id: "interviewed", label: "Interviewed" },
  { id: "committed", label: "Committed" },
  { id: "core_group", label: "Core Group" },
];

export function StatusTimeline({ currentStatus }: StatusTimelineProps) {
  const getStepState = (stepId: PersonStatus) => {
    const currentIndex = STATUS_STEPS.findIndex((s) => s.id === currentStatus);
    const stepIndex = STATUS_STEPS.findIndex((s) => s.id === stepId);

    const isCoreGroupOrHigher =
      currentStatus === "core_group" ||
      currentStatus === "launch_team" ||
      currentStatus === "leader";

    if (stepId === "core_group" && isCoreGroupOrHigher) {
      return "current";
    }

    if (isCoreGroupOrHigher && stepIndex < STATUS_STEPS.length - 1) {
      return "completed";
    }

    if (stepIndex < currentIndex) return "completed";
    if (stepIndex === currentIndex) return "current";
    return "pending";
  };

  return (
    <nav aria-label="Progress" className="w-full">
      <ol role="list" className="flex items-center justify-between">
        {STATUS_STEPS.map((step, stepIdx) => {
          const state = getStepState(step.id);
          const isLast = stepIdx === STATUS_STEPS.length - 1;

          return (
            <li
              key={step.label}
              className={cn("relative flex-1", isLast && "flex-none")}
            >
              <div className="flex items-center">
                {/* Step circle */}
                <div className="relative flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                      state === "completed" &&
                        "border-muted-foreground/40 bg-muted-foreground/40 text-background",
                      state === "current" &&
                        "border-[var(--color-ef)] bg-[var(--color-ef)] text-[var(--color-ef-dark)] ring-4 ring-[var(--color-ef)]/20",
                      state === "pending" && "border-muted bg-background"
                    )}
                  >
                    {state === "completed" ? (
                      <Check className="h-4 w-4" />
                    ) : state === "current" ? (
                      <div className="h-2 w-2 rounded-full bg-[var(--color-ef-dark)]" />
                    ) : (
                      <div className="bg-muted h-2 w-2 rounded-full" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "absolute top-10 text-[10px] font-medium whitespace-nowrap",
                      state === "current"
                        ? "font-semibold text-[var(--color-ef-dark)]"
                        : state === "completed"
                          ? "text-muted-foreground"
                          : "text-muted-foreground/60"
                    )}
                  >
                    {step.label}
                  </span>
                </div>

                {/* Connecting line */}
                {!isLast && (
                  <div
                    className={cn(
                      "mx-2 h-0.5 flex-1",
                      state === "completed" ? "bg-primary" : "bg-muted"
                    )}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
