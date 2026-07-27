import { Check, GraduationCap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { PersonTrainingItem } from "@/lib/ministry-teams/service";

import {
  formatCalendarDate,
  sortTrainingItems,
  summarizeTraining,
} from "./person-teams-presentation";

interface PersonTrainingProgressProps {
  items: PersonTrainingItem[];
}

/**
 * The person profile's Training Progress card: the training programs that apply
 * to this person and which of them they have a completion recorded for.
 */
export function PersonTrainingProgress({ items }: PersonTrainingProgressProps) {
  const summary = summarizeTraining(items);
  const sorted = sortTrainingItems(items);

  const progressLabel =
    summary.requiredTotal > 0
      ? `${summary.requiredCompleted} of ${summary.requiredTotal} required complete`
      : `${summary.completed} of ${summary.total} complete`;

  return (
    <Card data-testid="person-training-progress">
      <CardHeader>
        <CardTitle>Training Progress</CardTitle>
        <CardDescription>
          {summary.total === 0
            ? "Training programs assigned to this person"
            : progressLabel}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {summary.total === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-6 text-center"
            data-testid="person-training-progress-empty"
          >
            <GraduationCap
              className="text-muted-foreground h-8 w-8"
              aria-hidden
            />
            <p className="mt-3 font-medium">No training assigned</p>
            <p className="text-muted-foreground mt-1 max-w-xs text-sm text-balance">
              Training programs for this person&apos;s teams — and any
              church-wide programs — will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Progress
                value={summary.percentComplete}
                aria-label={`Training completion: ${progressLabel}`}
              />
              <p
                className="text-muted-foreground text-sm"
                data-testid="person-training-progress-summary"
              >
                {progressLabel}
                {summary.requiredTotal > 0 && summary.completed > 0
                  ? ` · ${summary.completed} of ${summary.total} total`
                  : ""}
              </p>
            </div>

            <ul className="divide-border divide-y">
              {sorted.map((item) => {
                const completedOn = formatCalendarDate(item.completedAt);

                return (
                  <li
                    key={item.programId}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        {item.completedAt !== null && (
                          <Check
                            className="h-4 w-4 shrink-0 text-green-600 dark:text-green-500"
                            aria-hidden
                          />
                        )}
                        <span className="truncate">{item.programName}</span>
                      </p>
                      <p className="text-muted-foreground truncate text-sm">
                        {item.teamName ?? "Church-wide"}
                        {completedOn ? ` · completed ${completedOn}` : ""}
                      </p>
                    </div>
                    {item.completedAt !== null ? (
                      <Badge variant="secondary">Complete</Badge>
                    ) : (
                      <Badge variant={item.isRequired ? "outline" : "ghost"}>
                        {item.isRequired ? "Required" : "Optional"}
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
