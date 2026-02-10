"use client";

import { useState } from "react";
import { Check, GraduationCap, Plus, X } from "lucide-react";

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
import { cn } from "@/lib/utils";
import {
  createTrainingProgramAction,
  markTrainingCompleteAction,
} from "@/app/(dashboard)/teams/actions";
import type { TrainingProgram } from "@/db/schema";
import type { TrainingMatrixRow } from "@/lib/ministry-teams/service";

interface TrainingTabProps {
  teamId: string;
  programs: TrainingProgram[];
  matrix: TrainingMatrixRow[];
}

export function TrainingTab({ teamId, programs, matrix }: TrainingTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  async function handleAddProgram(formData: FormData) {
    setAddLoading(true);
    formData.set("teamId", teamId);
    try {
      const result = await createTrainingProgramAction(formData);
      if (result.success) {
        setAddOpen(false);
      }
    } finally {
      setAddLoading(false);
    }
  }

  async function handleMarkComplete(personId: string, programId: string) {
    await markTrainingCompleteAction({ personId, programId });
  }

  if (programs.length === 0 && matrix.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Training</h2>
          <AddProgramDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            loading={addLoading}
            onSubmit={handleAddProgram}
          />
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <GraduationCap className="text-muted-foreground h-10 w-10" />
            <h3 className="mt-3 font-medium">No training programs</h3>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm">
              Add training programs to track completion across team members.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Training Matrix
        </h2>
        <AddProgramDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          loading={addLoading}
          onSubmit={handleAddProgram}
        />
      </div>

      {/* Training completion matrix */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="px-4 py-3 text-left font-medium">Team Member</th>
              {programs.map((program) => (
                <th
                  key={program.id}
                  className="px-3 py-3 text-center font-medium"
                >
                  <div className="flex flex-col items-center gap-1">
                    <span className="max-w-[120px] truncate">
                      {program.name}
                    </span>
                    {program.isRequired && (
                      <Badge variant="outline" className="text-[10px]">
                        Required
                      </Badge>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.personId} className="border-b last:border-b-0">
                <td className="px-4 py-3 font-medium">{row.personName}</td>
                {programs.map((program) => {
                  const isComplete = row.completions[program.id];
                  return (
                    <td key={program.id} className="px-3 py-3 text-center">
                      {isComplete ? (
                        <div className="flex items-center justify-center">
                          <Check className="h-5 w-5 text-green-500" />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="hover:bg-muted inline-flex cursor-pointer items-center justify-center rounded p-1 transition-colors"
                          onClick={() =>
                            handleMarkComplete(row.personId, program.id)
                          }
                          title="Mark as complete"
                        >
                          <X className="text-muted-foreground/30 h-5 w-5" />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {matrix.length === 0 && (
              <tr>
                <td
                  colSpan={programs.length + 1}
                  className="text-muted-foreground px-4 py-8 text-center"
                >
                  No team members assigned yet. Assign members on the Members &
                  Roles tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
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
