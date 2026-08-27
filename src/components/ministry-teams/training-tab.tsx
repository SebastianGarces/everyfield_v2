"use client";

import { GraduationCap, Plus } from "lucide-react";

import { useCan } from "@/components/shared/viewer-capabilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  TrainingMatrix,
  TrainingMatrixIncompleteMarker,
} from "@/components/ministry-teams/training-matrix";
import {
  createTrainingProgramAction,
  markTrainingCompleteAction,
} from "@/app/(dashboard)/teams/actions";
import type { TrainingProgram } from "@/db/schema";
import type { TrainingMatrixRow } from "@/lib/ministry-teams/service";
import { useDialogSaveLifecycle } from "./dialog-save-lifecycle";

interface TrainingTabProps {
  teamId: string;
  programs: TrainingProgram[];
  matrix: TrainingMatrixRow[];
}

export function TrainingTab({ teamId, programs, matrix }: TrainingTabProps) {
  const {
    open: addOpen,
    loading: addLoading,
    error: addError,
    onOpenChange: onAddOpenChange,
    submit: submitAddProgram,
  } = useDialogSaveLifecycle();

  // `createTrainingProgramAction` and `markTrainingCompleteAction` are both
  // `teams.write` (AS-020, #499). The MATRIX is the read — who has completed
  // what — and it survives whole, because the grid already takes its one
  // interactive cell as a render prop.
  const canWrite = useCan("teams.write");

  async function handleAddProgram(formData: FormData) {
    formData.set("teamId", teamId);
    await submitAddProgram(() => createTrainingProgramAction(formData));
  }

  async function handleMarkComplete(personId: string, programId: string) {
    await markTrainingCompleteAction({ personId, programId });
  }

  if (programs.length === 0 && matrix.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Training</h2>
          {canWrite && (
            <AddProgramDialog
              open={addOpen}
              onOpenChange={onAddOpenChange}
              loading={addLoading}
              error={addError}
              onSubmit={handleAddProgram}
            />
          )}
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <GraduationCap className="text-muted-foreground h-10 w-10" />
            <h3 className="mt-3 font-medium">No training programs</h3>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm">
              {canWrite
                ? "Add training programs to track completion across team members."
                : "Your plant's admins set up this team's training programs."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Training Matrix</h2>
        {canWrite && (
          <AddProgramDialog
            open={addOpen}
            onOpenChange={onAddOpenChange}
            loading={addLoading}
            error={addError}
            onSubmit={handleAddProgram}
          />
        )}
      </div>

      {/* Training completion matrix. The grid itself is presentational and
          lives in training-matrix.tsx; this tab only supplies the one
          interactive cell — the click that marks a training complete.
          WITHOUT `incompleteCell` the grid draws its own inert marker in the
          same box, which is the read-only render it already documents — so
          hiding the write here is withholding the prop, not a second branch
          through the table. */}
      <TrainingMatrix
        programs={programs}
        matrix={matrix}
        incompleteCell={
          canWrite
            ? ({ personId, programId }) => (
                <button
                  type="button"
                  className="hover:bg-muted inline-flex cursor-pointer items-center justify-center rounded p-1 transition-colors"
                  onClick={() => handleMarkComplete(personId, programId)}
                  title="Mark as complete"
                >
                  <TrainingMatrixIncompleteMarker />
                </button>
              )
            : undefined
        }
      />

      {/* Training stats */}
      <div className="flex gap-4">
        <Badge variant="secondary" className="text-xs">
          {programs.length} program{programs.length !== 1 ? "s" : ""}
        </Badge>
        <Badge variant="secondary" className="text-xs">
          {programs.filter((p) => p.isRequired).length} required
        </Badge>
      </div>
    </div>
  );
}

// Inline Add Program Dialog
function AddProgramDialog({
  open,
  onOpenChange,
  loading,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer">
          <Plus className="mr-2 h-4 w-4" />
          Add Program
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add Training Program</DialogTitle>
            <DialogDescription>
              Create a training program to track across team members.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Program Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., Child Safety Training"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Describe the training program..."
                rows={3}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isRequired"
                name="isRequired"
                value="true"
                className="cursor-pointer"
              />
              <Label htmlFor="isRequired" className="cursor-pointer">
                This training is required
              </Label>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="cursor-pointer">
              {loading ? "Adding..." : "Add Program"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
