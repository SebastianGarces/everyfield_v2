"use client";

import { toggleChecklistItemAction } from "@/app/(dashboard)/vision-meetings/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import type { ChecklistCategory, MeetingChecklistItem } from "@/db/schema";
import { CheckCircle, Package } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

interface MaterialsChecklistProps {
  meetingId: string;
  items: MeetingChecklistItem[];
  summary: { total: number; checked: number };
}

const categoryLabels: Record<ChecklistCategory, string> = {
  essential: "Essential",
  materials: "Materials",
  setup: "Setup",
  av: "AV Equipment",
  organization: "Organization",
};

const categoryOrder: ChecklistCategory[] = [
  "essential",
  "materials",
  "setup",
  "av",
  "organization",
];

export function MaterialsChecklist({
  meetingId,
  items,
  summary,
}: MaterialsChecklistProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const grouped = categoryOrder.reduce(
    (acc, cat) => {
      acc[cat] = items.filter((item) => item.category === cat);
      return acc;
    },
    {} as Record<ChecklistCategory, MeetingChecklistItem[]>
  );

  const progressPercent =
    summary.total > 0 ? Math.round((summary.checked / summary.total) * 100) : 0;

  const handleToggle = (itemId: string, currentlyChecked: boolean) => {
    startTransition(async () => {
      await toggleChecklistItemAction(itemId, !currentlyChecked);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="text-muted-foreground h-4 w-4" />
              <span className="text-sm font-medium">Preparation Progress</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {summary.checked === summary.total && summary.total > 0 && (
                <CheckCircle className="h-4 w-4 text-green-600" />
              )}
              <span className="font-medium">
                {summary.checked}/{summary.total}
              </span>
              <span className="text-muted-foreground">ready</span>
            </div>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </CardContent>
      </Card>

      {categoryOrder.map((category) => {
        const categoryItems = grouped[category];
        if (!categoryItems || categoryItems.length === 0) return null;

        return (
          <Card key={category}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {categoryLabels[category]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {categoryItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-3">
                    <Checkbox
                      id={item.id}
                      checked={item.isChecked}
                      onCheckedChange={() =>
                        handleToggle(item.id, item.isChecked)
                      }
                      disabled={isPending}
                      className="cursor-pointer"
                    />
                    <label
                      htmlFor={item.id}
                      className={`flex-1 cursor-pointer text-sm ${
                        item.isChecked
                          ? "text-muted-foreground line-through"
                          : ""
                      }`}
                    >
                      {item.itemName}
                    </label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {items.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="text-muted-foreground/50 mx-auto h-12 w-12" />
            <h3 className="mt-4 font-semibold">No checklist items</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Checklist items are automatically created when a meeting is
              scheduled.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
