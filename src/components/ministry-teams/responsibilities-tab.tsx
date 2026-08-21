"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { ListChecks, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  createResponsibilityAction,
  setResponsibilityCompleteAction,
} from "@/app/(dashboard)/teams/actions";
import type { TeamResponsibility } from "@/db/schema";

import { ResponsibilityItem } from "./responsibility-item";

interface ResponsibilitiesTabProps {
  teamId: string;
  /** Server data, straight from `listResponsibilities` — props, never state. */
  responsibilities: TeamResponsibility[];
}

/**
 * The team's checklist (MT-002b, #311 WS1).
 *
 * SERVER DATA ARRIVES AS PROPS AND STAYS THERE. The only local copy is
 * `useOptimistic`, which React discards the moment the revalidated props land
 * (`memory/invariants.md` → Client/Server Data Synchronization) — a `useState`
 * mirror would go stale against exactly that repaint. Ticking is the one
 * interaction fast enough to feel wrong at a round trip, so it is the one that
 * gets an optimistic value; adding and deleting say what they are doing on
 * their button instead.
 */
export function ResponsibilitiesTab({
  teamId,
  responsibilities,
}: ResponsibilitiesTabProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();

  const [items, applyToggle] = useOptimistic(
    responsibilities,
    (current, toggled: { id: string; complete: boolean }) =>
      current.map((item) =>
        item.id === toggled.id
          ? { ...item, completedAt: toggled.complete ? new Date() : null }
          : item
      )
  );

  const completed = items.filter((item) => item.completedAt !== null).length;

  function handleToggle(responsibility: TeamResponsibility, complete: boolean) {
    startTransition(async () => {
      applyToggle({ id: responsibility.id, complete });
      const result = await setResponsibilityCompleteAction(
        responsibility.id,
        complete
      );
      // The optimistic value is dropped either way when the transition ends;
      // on a refusal the props are still the truth, so the row snaps back and
      // the toast says why.
      if (!result.success) toast.error(result.error);
    });
  }

  async function handleAdd(formData: FormData) {
    setAdding(true);
    try {
      const result = await createResponsibilityAction(teamId, formData);
      if (result.success) {
        formRef.current?.reset();
      } else {
        toast.error(result.error);
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Responsibilities ({items.length})
        </h2>
        {items.length > 0 && (
          <div className="flex items-center gap-3">
            <Progress
              value={(completed / items.length) * 100}
              className="h-2 w-24"
            />
            <span className="text-muted-foreground text-sm">
              {completed} of {items.length} complete
            </span>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <ListChecks className="text-muted-foreground h-10 w-10" />
            <h3 className="mt-3 font-medium">No responsibilities yet</h3>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm">
              Add what this team owns. Each one can be ticked off as the team
              gets it done.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((responsibility) => (
            <ResponsibilityItem
              key={responsibility.id}
              responsibility={responsibility}
              onToggle={handleToggle}
            />
          ))}
        </ul>
      )}

      <form
        ref={formRef}
        action={handleAdd}
        className="flex items-center gap-2"
      >
        <Input
          name="title"
          placeholder="Add a responsibility..."
          maxLength={255}
          required
          aria-label="New responsibility"
        />
        <Button type="submit" disabled={adding} className="cursor-pointer">
          <Plus className="mr-2 h-4 w-4" />
          {adding ? "Adding..." : "Add"}
        </Button>
      </form>
    </div>
  );
}
