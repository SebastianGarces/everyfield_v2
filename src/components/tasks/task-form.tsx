"use client";

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
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import {
  taskCategories,
  taskPriorities,
  taskStatuses,
  type Task,
} from "@/db/schema";
import type { PrerequisiteCandidate } from "@/lib/tasks/dependencies";
import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createTaskAction,
  updateTaskAction,
} from "@/app/(dashboard)/tasks/actions";
import {
  NO_RECURRENCE,
  parseRecurrenceRule,
  recurrenceIntervals,
  RECURRENCE_INTERVAL_LABELS,
} from "@/lib/tasks/recurrence";
// Descriptions written before T-021 are plain text with newlines. There is no
// migration — `toRichTextHtml` is the one door, and it converts them on the way
// into the editor exactly as it does for message templates.
import { toRichTextHtml } from "@/lib/rich-text/format";
import { OWNED_TASK_CATEGORY as FOLLOW_UP_CATEGORY } from "@/lib/tasks/follow-up-ownership.shared";
import { toast } from "sonner";

// ============================================================================
// Config
// ============================================================================

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  blocked: "Blocked",
  complete: "Complete",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const CATEGORY_LABELS: Record<string, string> = {
  vision_meeting: "Vision Meeting",
  follow_up: "Follow-up",
  training: "Training",
  facilities: "Facilities",
  promotion: "Promotion",
  administrative: "Administrative",
  ministry_team: "Ministry Team",
  launch_prep: "Launch Prep",
  recurring: "Recurring",
  general: "General",
};

// ============================================================================
// Description field (T-021)
// ============================================================================

const DESCRIPTION_ID = "description";
const DESCRIPTION_LABEL_ID = "description-label";

interface TaskDescriptionFieldProps {
  /** HTML, or a legacy plain-text description, already converted by the caller. */
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
}

/**
 * The task description, on the product's ONE rich-text editor (COM-017).
 *
 * Exported so its markup can be asserted without a router: the form around it
 * calls `useRouter`, which cannot be rendered outside the app router, and the
 * things worth pinning here — `cursor-pointer` on every control, a labelled
 * textbox, the HTML actually reaching the request — all live in this subtree.
 *
 * The editor is a `contentEditable` div, so it carries no form value of its
 * own. The hidden input beside it is what puts the description into the
 * `FormData` the submit handler reads, which keeps the rest of this form
 * uncontrolled and the server contract (`description`) unchanged.
 *
 * `<Label htmlFor>` does not associate with a div — only labelable elements —
 * so the accessible name is wired the other way, through `aria-labelledby`.
 */
export function TaskDescriptionField({
  value,
  onChange,
  disabled = false,
}: TaskDescriptionFieldProps) {
  return (
    <>
      <RichTextEditor
        id={DESCRIPTION_ID}
        value={value}
        onChange={onChange}
        aria-labelledby={DESCRIPTION_LABEL_ID}
        placeholder="Add details about this task..."
        disabled={disabled}
        editorClassName="min-h-[140px]"
      />
      <input type="hidden" name="description" value={value} />
    </>
  );
}

// ============================================================================
// Prerequisites field (T-015)
// ============================================================================

export interface TaskPrerequisitesFieldProps {
  candidates: PrerequisiteCandidate[];
  selectedIds?: string[];
  disabled?: boolean;
}

/**
 * The prerequisite picker. Exported so its markup can be asserted without a
 * router: `TaskForm` calls `useRouter`, and everything worth pinning here —
 * `cursor-pointer` on every control, the ids reaching the request — lives in
 * this subtree.
 *
 * Selected ids travel in one hidden input (comma-separated) because the
 * form helper that builds the action payload overwrites repeated names.
 */
export function TaskPrerequisitesField({
  candidates,
  selectedIds = [],
  disabled = false,
}: TaskPrerequisitesFieldProps) {
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const selectedSet = new Set(selected);
  const available = candidates.filter(
    (candidate) => !selectedSet.has(candidate.id)
  );
  const selectedRows = selected.flatMap((id) => {
    const row = candidates.find((candidate) => candidate.id === id);
    return row ? [row] : [];
  });

  function add(id: string) {
    if (!id || selectedSet.has(id)) return;
    setSelected((current) => [...current, id]);
  }

  function remove(id: string) {
    setSelected((current) => current.filter((value) => value !== id));
  }

  return (
    <div className="space-y-2">
      <input
        type="hidden"
        name="prerequisiteTaskIds"
        value={selected.join(",")}
      />

      {selectedRows.length > 0 && (
        <ul className="space-y-1.5">
          {selectedRows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate">{row.title}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground cursor-pointer rounded-sm p-0.5"
                aria-label={`Remove prerequisite ${row.title}`}
                onClick={() => remove(row.id)}
                disabled={disabled}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <Select
          key={selected.join(",")}
          onValueChange={add}
          disabled={disabled}
        >
          <SelectTrigger className="cursor-pointer">
            <SelectValue placeholder="Add a prerequisite…" />
          </SelectTrigger>
          <SelectContent>
            {available.map((candidate) => (
              <SelectItem
                key={candidate.id}
                value={candidate.id}
                className="cursor-pointer"
              >
                {candidate.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : candidates.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Create another task first to set a prerequisite.
        </p>
      ) : null}

      <p className="text-muted-foreground text-sm">
        This task stays blocked until every prerequisite is complete.
      </p>
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

interface TaskFormProps {
  task?: Task; // If provided, we're editing
  users?: { id: string; name: string | null; email: string }[];
  /**
   * The accounts a FOLLOW-UP may be assigned to — committed members only
   * (#470 D2). A subset of `users`, resolved on the server by the same query
   * the write-path guard uses, so the select cannot offer somebody the save
   * will refuse.
   */
  followUpAssignees?: { id: string; name: string | null; email: string }[];
  prerequisiteCandidates?: PrerequisiteCandidate[];
  prerequisiteIds?: string[];
}

export function TaskForm({
  task,
  users = [],
  followUpAssignees = [],
  prerequisiteCandidates = [],
  prerequisiteIds = [],
}: TaskFormProps) {
  const router = useRouter();

  // NOT `useTransition`, and the form is wired through `onSubmit` rather than
  // `action` — see `handleSubmit` for why. This is the same "in flight" flag a
  // transition gave, owned here so the submit is not React's to schedule.
  const [isPending, setIsPending] = useState(false);

  const isEditing = !!task;

  // The stored rule, read once for the defaults below.
  const savedRule = parseRecurrenceRule(task?.recurrenceRule);

  // UI state, not server data: it only decides whether the end-date field is
  // on screen. The values themselves are uncontrolled and travel in FormData.
  const [interval, setInterval] = useState<string>(
    task?.isRecurring && savedRule ? savedRule.interval : NO_RECURRENCE
  );
  const repeats = interval !== NO_RECURRENCE;

  // Form input state, the same thing `defaultValue` holds for every other field
  // here — the editor is a contentEditable surface, so its value has to be held
  // somewhere it can be read from at submit time.
  const [description, setDescription] = useState(() =>
    toRichTextHtml(task?.description)
  );

  // CATEGORY AND ASSIGNEE ARE CONTROLLED, and only these two (#470 AC-2).
  // Every other field here is uncontrolled and travels in FormData, which is
  // still the right default — but these two are not independent: only a
  // committed member may own a follow-up, so the category decides which names
  // the assignee select is allowed to offer.
  const [category, setCategory] = useState<string>(task?.category ?? "");
  const [assignedToId, setAssignedToId] = useState<string>(
    task?.assignedToId ?? ""
  );

  const isFollowUp = category === FOLLOW_UP_CATEGORY;
  const assigneeOptions = isFollowUp ? followUpAssignees : users;

  /**
   * Re-categorising to Follow-up while an ineligible member is selected CLEARS
   * the selection rather than leaving a name the save would refuse. Silence
   * would be worse than the clear: the planter would press Save, be told no,
   * and have to work out which of eight fields the refusal was about.
   */
  function chooseCategory(next: string) {
    setCategory(next);
    if (
      next === FOLLOW_UP_CATEGORY &&
      assignedToId &&
      !followUpAssignees.some((u) => u.id === assignedToId)
    ) {
      setAssignedToId("");
    }
  }

  // --------------------------------------------------------------------------
  // A SUBMIT THAT LEAVES OWNS NO TRANSITION AND NO REFRESH (#228, #526, #529)
  // --------------------------------------------------------------------------
  //
  // memory/invariants.md → Client/Server Data Synchronization: a click that
  // navigates must not own a transition or a refresh on the route being LEFT,
  // because either turns the click into work React is still doing on the route
  // the push is trying to replace. This form was the full banned shape —
  // `startTransition` around actions that each called `refresh()`, with
  // `router.push("/tasks")` inside the same transition.
  //
  // Three things had to move, and the third is why this is `onSubmit` rather
  // than `action`:
  //
  //   1. `refresh()` left `createTaskAction`/`updateTaskAction`. Both have
  //      exactly ONE caller — this form — and it always navigates away, so the
  //      refresh only ever re-rendered a route nobody was going to be on. The
  //      `revalidatePath` calls stay: they freshen /tasks, which is where the
  //      planter lands.
  //   2. The transition is gone. `isPending` is plain state now.
  //   3. `<form action={fn}>` runs `fn` inside a transition REACT owns, so
  //      dropping `useTransition` while keeping `action` would have changed
  //      nothing. `onSubmit` is the wiring that actually leaves the push
  //      outside one.
  //
  // `isPending` is deliberately NOT cleared on success: the form is leaving, and
  // re-enabling the button while the push is in flight invites a second submit
  // that creates a second task.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    const formData = new FormData(event.currentTarget);
    setIsPending(true);

    // Narrowed on the row itself rather than on `isEditing`, so the id needs no
    // non-null assertion to reach the action.
    const result = task
      ? await updateTaskAction(task.id, formData)
      : await createTaskAction(formData);

    if (!result.success) {
      setIsPending(false);
      toast.error(result.error);
      return;
    }

    toast.success(isEditing ? "Task updated" : "Task created");
    router.push("/tasks");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">
          Title <span className="text-red-500">*</span>
        </Label>
        <Input
          id="title"
          name="title"
          defaultValue={task?.title}
          placeholder="What needs to be done?"
          required
          disabled={isPending}
        />
      </div>

      {/* Description (T-021) */}
      <div className="space-y-2">
        <Label id={DESCRIPTION_LABEL_ID} htmlFor={DESCRIPTION_ID}>
          Description
        </Label>
        <TaskDescriptionField
          value={description}
          onChange={setDescription}
          disabled={isPending}
        />
      </div>

      {/* Status and Priority row */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select name="status" defaultValue={task?.status ?? "not_started"}>
            <SelectTrigger className="cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {taskStatuses.map((s) => (
                <SelectItem key={s} value={s} className="cursor-pointer">
                  {STATUS_LABELS[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Select name="priority" defaultValue={task?.priority ?? "medium"}>
            <SelectTrigger className="cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {taskPriorities.map((p) => (
                <SelectItem key={p} value={p} className="cursor-pointer">
                  {PRIORITY_LABELS[p] ?? p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Due date and Category row */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dueDate">Due Date</Label>
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={task?.dueDate ?? ""}
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select
            name="category"
            value={category}
            onValueChange={chooseCategory}
          >
            <SelectTrigger className="cursor-pointer">
              <SelectValue placeholder="Select category..." />
            </SelectTrigger>
            <SelectContent>
              {taskCategories.map((c) => (
                <SelectItem key={c} value={c} className="cursor-pointer">
                  {CATEGORY_LABELS[c] ?? c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Assignee */}
      {users.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="assignedToId">Assigned To</Label>
          <Select
            name="assignedToId"
            value={assignedToId}
            onValueChange={setAssignedToId}
          >
            <SelectTrigger className="cursor-pointer">
              <SelectValue placeholder="Select assignee..." />
            </SelectTrigger>
            <SelectContent>
              {assigneeOptions.map((u) => (
                <SelectItem key={u.id} value={u.id} className="cursor-pointer">
                  {u.name ?? u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isFollowUp && (
            <p className="text-muted-foreground text-xs">
              {assigneeOptions.length === 0
                ? "Nobody has a committed status yet, so no one can own a follow-up."
                : "Follow-ups can only be owned by Core Group, Launch Team or Leader members."}
            </p>
          )}
        </div>
      )}

      {/* Prerequisites (T-015) */}
      <div className="space-y-2">
        <Label>Prerequisites</Label>
        <TaskPrerequisitesField
          candidates={prerequisiteCandidates}
          selectedIds={prerequisiteIds}
          disabled={isPending}
        />
      </div>

      {/* Repeat (T-017) */}
      <div className="space-y-4 rounded-md border p-4">
        <div className="space-y-2">
          <Label htmlFor="recurrenceInterval">Repeat</Label>
          <Select
            name="recurrenceInterval"
            value={interval}
            onValueChange={setInterval}
          >
            <SelectTrigger id="recurrenceInterval" className="cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_RECURRENCE} className="cursor-pointer">
                Does not repeat
              </SelectItem>
              {recurrenceIntervals.map((value) => (
                <SelectItem
                  key={value}
                  value={value}
                  className="cursor-pointer"
                >
                  {RECURRENCE_INTERVAL_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-sm">
            The next one is created when you complete this task, so a repeating
            task never piles up while you are away. Its subtasks come across
            too, with every box unticked.
          </p>
        </div>

        {repeats && (
          <div className="space-y-2">
            <Label htmlFor="recurrenceEndDate">Repeat until</Label>
            <Input
              id="recurrenceEndDate"
              name="recurrenceEndDate"
              type="date"
              defaultValue={savedRule?.endDate ?? ""}
              disabled={isPending}
            />
            <p className="text-muted-foreground text-sm">
              Leave this empty to repeat indefinitely. Past the end date the
              task stops repeating; everything already completed stays on the
              record.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4">
        <Button type="submit" disabled={isPending} className="cursor-pointer">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEditing ? "Save Changes" : "Create Task"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
