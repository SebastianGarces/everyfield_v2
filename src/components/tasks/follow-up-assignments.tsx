"use client";

import { AlertCircle, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useCan } from "@/components/shared/viewer-capabilities";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignFollowUpAction,
  createAndAssignFollowUpAction,
} from "@/app/(dashboard)/tasks/follow-up-actions";
import type {
  FollowUpAssignee,
  FollowUpOwnerGroup,
} from "@/lib/tasks/follow-up-ownership.shared";
import { NEEDS_OWNER_LABEL } from "@/lib/tasks/follow-up-ownership.shared";
import { STATUS_LABELS } from "@/lib/people/status.shared";
import type { PersonStatus } from "@/db/schema";

// ============================================================================
// WHO IS CARRYING THE FOLLOW-UP (#470 AC-3).
//
// The view exists so the answer stops being a guess. Two kinds of row appear
// under "Needs owner", and they are deliberately not separated: a follow-up
// whose task nobody holds, and a contact who has no task at all (Q1). To the
// planter both are the same thing — somebody waiting who nobody is on — and
// splitting them into two lists would make the second one easy to never read.
//
// EVERY ASSIGNMENT IS ONE CLICK. Choosing a name in a row's select performs the
// write; there is no second confirm button, because the whole list is a queue of
// small identical decisions and a confirm step on each one is what makes a queue
// go unworked.
// ============================================================================

/** A contact in follow-up with nobody on them — Q1's row. */
export interface UncoveredContact {
  personId: string;
  name: string;
  status: PersonStatus;
  /** Whole days since the contact was last touched, against the page's clock. */
  idleDays: number;
  isStale: boolean;
}

interface FollowUpAssignmentsProps {
  groups: FollowUpOwnerGroup[];
  uncovered: UncoveredContact[];
  assignees: FollowUpAssignee[];
}

const ASSIGN_PLACEHOLDER = "Assign to…";

/**
 * The one control every row carries. `disabled` while its own write is in
 * flight — a row is its own unit of work, so a slow assignment must not freeze
 * the twenty rows under it.
 *
 * ONE GATE FOR ALL THREE CALL SITES. Assigning, reassigning and creating-and-
 * assigning are `tasks.write` to a one (`follow-up-actions.ts`), and they are
 * the same control in three places, so the question is asked where the control
 * is drawn rather than three rows up. A read-only viewer keeps the VIEW — who
 * is carrying what, and what nobody is on — and loses only the handing-out.
 */
function AssigneeSelect({
  assignees,
  label,
  onPick,
  pending,
  value,
}: {
  assignees: FollowUpAssignee[];
  label: string;
  onPick: (assigneeId: string) => void;
  pending: boolean;
  value?: string;
}) {
  const canAssign = useCan("tasks.write");

  if (!canAssign) return null;

  if (assignees.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        No committed members to assign
      </span>
    );
  }

  return (
    <Select value={value} onValueChange={onPick} disabled={pending}>
      <SelectTrigger
        aria-label={label}
        className="h-8 w-[190px] cursor-pointer text-xs"
      >
        <SelectValue placeholder={ASSIGN_PLACEHOLDER} />
      </SelectTrigger>
      <SelectContent>
        {assignees.map((assignee) => (
          <SelectItem key={assignee.id} value={assignee.id}>
            {assignee.name ?? assignee.email}
            {assignee.isPlanter ? " (you)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FollowUpAssignments({
  groups,
  uncovered,
  assignees,
}: FollowUpAssignmentsProps) {
  const canAssign = useCan("tasks.write");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyRow, setBusyRow] = useState<string | null>(null);

  function run(
    rowId: string,
    work: () => Promise<{ ok: boolean; msg: string }>
  ) {
    setBusyRow(rowId);
    startTransition(async () => {
      const result = await work();
      setBusyRow(null);
      if (result.ok) {
        toast.success(result.msg);
        router.refresh();
      } else {
        toast.error(result.msg);
      }
    });
  }

  const needsOwner = groups[0];
  const owners = groups.slice(1);
  const uncoveredWithTask = needsOwner.tasks.length;

  return (
    <div className="space-y-6">
      {/* Needs owner — pinned, and the only group that is work rather than a report. */}
      <section
        id="needs-owner"
        aria-labelledby="needs-owner-heading"
        className="border-destructive/30 bg-destructive/5 rounded-lg border p-4"
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertCircle className="text-destructive h-4 w-4 shrink-0" />
          <h2 id="needs-owner-heading" className="text-sm font-semibold">
            {NEEDS_OWNER_LABEL}
          </h2>
          <Badge variant="outline" className="text-xs">
            {uncoveredWithTask + uncovered.length}
          </Badge>
        </div>

        {uncoveredWithTask === 0 && uncovered.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Every open follow-up has a committed member on it.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {needsOwner.tasks.map((task) => (
              <li
                key={task.taskId}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <Link
                    href={`/tasks/${task.taskId}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {task.title}
                  </Link>
                  {task.assignedToId !== null && (
                    <p className="text-muted-foreground text-xs">
                      {task.ownerName ?? task.ownerEmail} is no longer a
                      committed member
                    </p>
                  )}
                </div>
                <AssigneeSelect
                  assignees={assignees}
                  label={`Assign ${task.title}`}
                  pending={isPending && busyRow === task.taskId}
                  onPick={(assigneeId) =>
                    run(task.taskId, async () => {
                      const res = await assignFollowUpAction(
                        task.taskId,
                        assigneeId
                      );
                      return res.success
                        ? { ok: true, msg: "Follow-up owner set" }
                        : { ok: false, msg: res.error };
                    })
                  }
                />
              </li>
            ))}

            {/* Q1 — a contact with no task at all. Picking a name creates it. */}
            {uncovered.map((contact) => (
              <li
                key={contact.personId}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <UserPlus className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    <Link
                      href={`/people/${contact.personId}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {contact.name}
                    </Link>
                    <Badge variant="outline" className="text-xs">
                      {STATUS_LABELS[contact.status]}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    No open follow-up task ·{" "}
                    {contact.idleDays === 1
                      ? "waiting 1 day"
                      : `waiting ${contact.idleDays} days`}
                    {contact.isStale ? " · past the follow-up window" : ""}
                  </p>
                </div>
                <AssigneeSelect
                  assignees={assignees}
                  label={`Create and assign a follow-up for ${contact.name}`}
                  pending={isPending && busyRow === contact.personId}
                  onPick={(assigneeId) =>
                    run(contact.personId, async () => {
                      const res = await createAndAssignFollowUpAction(
                        contact.personId,
                        contact.name,
                        assigneeId
                      );
                      return res.success
                        ? {
                            ok: true,
                            msg: `Follow-up created for ${contact.name}`,
                          }
                        : { ok: false, msg: res.error };
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Everyone carrying something. A report, not a queue. */}
      {owners.map((group) => (
        <section
          key={group.ownerId}
          aria-labelledby={`owner-${group.ownerId}`}
          className="rounded-lg border p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <h2 id={`owner-${group.ownerId}`} className="text-sm font-semibold">
              {group.ownerName}
            </h2>
            <Badge variant="outline" className="text-xs">
              {group.tasks.length}
            </Badge>
          </div>
          <ul className="divide-border divide-y">
            {group.tasks.map((task) => (
              <li
                key={task.taskId}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <Link
                  href={`/tasks/${task.taskId}`}
                  className="min-w-0 text-sm hover:underline"
                >
                  {task.title}
                </Link>
                <AssigneeSelect
                  assignees={assignees}
                  label={`Reassign ${task.title}`}
                  value={task.assignedToId ?? undefined}
                  pending={isPending && busyRow === task.taskId}
                  onPick={(assigneeId) =>
                    run(task.taskId, async () => {
                      const res = await assignFollowUpAction(
                        task.taskId,
                        assigneeId
                      );
                      return res.success
                        ? { ok: true, msg: "Follow-up owner set" }
                        : { ok: false, msg: res.error };
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {owners.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {canAssign
            ? "Nobody owns a follow-up yet. Shared ownership of growth is the second Critical Success Factor — handing these out is the work."
            : "Nobody owns a follow-up yet. Your plant's admins hand these out."}
        </p>
      )}
    </div>
  );
}
