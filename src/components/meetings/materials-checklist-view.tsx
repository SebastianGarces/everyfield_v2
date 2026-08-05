// ============================================================================
// MaterialsChecklistView — the meeting preparation checklist, as pure markup.
//
// Presentational. It performs no data access, owns no state and registers no
// event handlers: it is handed the checklist rows plus the {total, checked}
// summary and renders the progress card, the per-category cards and the empty
// state. Checked state comes from the data (`item.isChecked`), never from
// internal state, so the same component renders a live checklist and a frozen
// fixture identically.
//
// The one interactive part — the box you click — is injected. The app's
// interactive host (components/meetings/materials-checklist.tsx) passes a
// `renderControl` that wires the toggle server action; callers that want a
// read-only render (the marketing page's live embed) pass nothing and get a
// controlled, handler-less checkbox that looks exactly like the app's.
//
// Contract for a custom `renderControl`: the row's <label> is bound with
// `htmlFor={item.id}`, so whatever the slot returns must carry `id={item.id}`
// for the label to keep pointing at it.
// ============================================================================

import type { ReactNode } from "react";
import { CheckCircle, Package } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import type { ChecklistCategory } from "@/db/schema";

/**
 * The shape the view actually reads. Deliberately narrower than the persisted
 * `MeetingChecklistItem` row, which satisfies it structurally — a fixture does
 * not have to invent audit columns to render this card.
 */
export interface MaterialsChecklistItemView {
  id: string;
  itemName: string;
  category: ChecklistCategory;
  isChecked: boolean;
}

export interface MaterialsChecklistViewProps {
  items: readonly MaterialsChecklistItemView[];
  summary: { total: number; checked: number };
  /**
   * The control at the head of each row. Omit it for a read-only render; the
   * default is the same checkbox the app uses, controlled and without a
   * handler, so it shows the state without changing it.
   */
  renderControl?: (item: MaterialsChecklistItemView) => ReactNode;
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

function defaultControl(item: MaterialsChecklistItemView) {
  return (
    <Checkbox
      id={item.id}
      checked={item.isChecked}
      className="cursor-pointer"
    />
  );
}

export function MaterialsChecklistView({
  items,
  summary,
  renderControl = defaultControl,
}: MaterialsChecklistViewProps) {
  const grouped = categoryOrder.reduce(
    (acc, cat) => {
      acc[cat] = items.filter((item) => item.category === cat);
      return acc;
    },
    {} as Record<ChecklistCategory, MaterialsChecklistItemView[]>
  );

  const progressPercent =
    summary.total > 0 ? Math.round((summary.checked / summary.total) * 100) : 0;

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
                    {renderControl(item)}
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
