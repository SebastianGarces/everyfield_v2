"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  deleteResponsibilityAction,
  updateResponsibilityAction,
} from "@/app/(dashboard)/teams/actions";
import type { TeamResponsibility } from "@/db/schema";

interface ResponsibilityItemProps {
  responsibility: TeamResponsibility;
  /** Ticking is the LIST's business — it owns the optimistic array. */
  onToggle: (responsibility: TeamResponsibility, complete: boolean) => void;
}

/**
 * One checklist row: a tick, the text, and the two things that can happen to
 * it.
 *
 * ERRORS GO TO THE ROOT `<Toaster>`, never into this card. Every action here
 * revalidates the team surfaces, and this row is inside what that repaint
 * replaces — an `<Alert>` in here would unmount itself mid-read
 * (`memory/invariants.md` → Client/Server Data Synchronization).
 */
export function ResponsibilityItem({
  responsibility,
  onToggle,
}: ResponsibilityItemProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const complete = responsibility.completedAt !== null;
  const checkboxId = `responsibility-${responsibility.id}`;

  async function handleEdit(formData: FormData) {
    setSaving(true);
    try {
      const result = await updateResponsibilityAction(
        responsibility.id,
        formData
      );
      if (result.success) {
        setEditOpen(false);
      } else {
        toast.error(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await deleteResponsibilityAction(responsibility.id);
      if (result.success) {
        setDeleteOpen(false);
      } else {
        toast.error(result.error);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li className="bg-card flex items-center gap-3 rounded-lg border p-3">
      {/* A REAL `<label>`, not an `aria-label` on the box. The title names the
          control either way, but a label puts the words INSIDE the same hit
          target — so ticking an item off is a click anywhere on its text, with
          no dead zone between the two. The checkbox role announces the state;
          the strike-through is the sighted half of that same fact and never
          the only cue. */}
      <Checkbox
        id={checkboxId}
        checked={complete}
        onCheckedChange={(checked) =>
          onToggle(responsibility, checked === true)
        }
        className="cursor-pointer"
      />

      <Label
        htmlFor={checkboxId}
        className={cn(
          "min-w-0 flex-1 cursor-pointer text-sm font-normal",
          complete && "text-muted-foreground line-through"
        )}
      >
        {responsibility.title}
      </Label>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-8 w-8 cursor-pointer"
            aria-label={`Edit ${responsibility.title}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form action={handleEdit}>
            <DialogHeader>
              <DialogTitle>Edit responsibility</DialogTitle>
              <DialogDescription>
                Change what this team is on the hook for.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-4">
              <Label htmlFor={`title-${responsibility.id}`}>
                Responsibility
              </Label>
              <Input
                id={`title-${responsibility.id}`}
                name="title"
                defaultValue={responsibility.title}
                maxLength={255}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="cursor-pointer"
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive h-8 w-8 cursor-pointer"
            aria-label={`Delete ${responsibility.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this responsibility?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{responsibility.title}</span> will
              be removed from this team&apos;s checklist. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" disabled={deleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="cursor-pointer"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
