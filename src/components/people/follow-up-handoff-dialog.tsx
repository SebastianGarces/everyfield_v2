"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { handOffFollowUpsAction } from "@/app/(dashboard)/tasks/follow-up-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FollowUpHandoff } from "@/lib/tasks/follow-up-ownership.shared";

// ============================================================================
// WHAT A DEMOTION LEAVES BEHIND (#470 Q2).
//
// Only a committed member may own a follow-up, so moving somebody out of the
// committed set makes every follow-up they held ownerless. That is not a
// failure state — the assignments view and the `/tasks` banner both pick those
// tasks up the moment the status lands — which is exactly why this dialog is
// SKIPPABLE. It is an offer to re-home the work while the planter still has the
// person in mind, not a repair the demotion is waiting on.
//
// ONE SELECT, ALL MOVE TOGETHER. The alternative — a row per task — turns a
// status change into a data-entry session, and the planter demoting somebody is
// in the middle of a different job.
// ============================================================================

interface FollowUpHandoffDialogProps {
  /** The handoff a status change reported, or `null` when it owed none. */
  handoff: FollowUpHandoff | null;
  onClose: () => void;
}

export function FollowUpHandoffDialog({
  handoff,
  onClose,
}: FollowUpHandoffDialogProps) {
  const [toUserId, setToUserId] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!handoff) return null;

  function close() {
    setToUserId("");
    onClose();
  }

  function submit() {
    if (!handoff || !toUserId) return;
    const { fromUserId } = handoff;

    startTransition(async () => {
      const result = await handOffFollowUpsAction(fromUserId, toUserId);
      if (result.success) {
        toast.success(
          result.data.moved === 1
            ? "1 follow-up moved"
            : `${result.data.moved} follow-ups moved`
        );
        close();
      } else {
        toast.error(result.error);
      }
    });
  }

  const count = handoff.openCount;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who should receive these follow-ups?</DialogTitle>
          <DialogDescription>
            {handoff.personName} owns{" "}
            {count === 1 ? "1 open follow-up" : `${count} open follow-ups`} and
            is no longer a committed member. Pick someone to take all of them,
            or skip — they will wait under &ldquo;Needs owner&rdquo; on Tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="handoff-assignee">New owner</Label>
          <Select
            value={toUserId}
            onValueChange={setToUserId}
            disabled={isPending}
          >
            <SelectTrigger
              id="handoff-assignee"
              className="w-full cursor-pointer"
            >
              <SelectValue placeholder="Select a committed member..." />
            </SelectTrigger>
            <SelectContent>
              {handoff.assignees.map((assignee) => (
                <SelectItem key={assignee.id} value={assignee.id}>
                  {assignee.name ?? assignee.email}
                  {assignee.isPlanter ? " (you)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {handoff.assignees.length === 0 && (
            <p className="text-muted-foreground text-xs">
              Nobody else holds a committed status yet, so these follow-ups stay
              under &ldquo;Needs owner&rdquo; for now.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={isPending}
          >
            Skip
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!toUserId || isPending}
          >
            {isPending ? "Moving..." : "Move all"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
