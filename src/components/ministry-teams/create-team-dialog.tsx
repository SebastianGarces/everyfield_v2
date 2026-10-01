"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import type { MinistryTeam } from "@/db/schema";
import {
  updateTeamAction,
  createTeamAction,
} from "@/app/(dashboard)/teams/actions";
import { useDialogSaveLifecycle } from "./dialog-save-lifecycle";

export function CreateTeamDialog({ team }: { team?: MinistryTeam } = {}) {
  const { open, loading, error, onOpenChange, submit } =
    useDialogSaveLifecycle();

  async function handleSubmit(formData: FormData) {
    await submit(() =>
      team ? updateTeamAction(team.id, formData) : createTeamAction(formData)
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="cursor-pointer">
          <Plus className="mr-2 h-4 w-4" />
          {team ? "Edit team" : "Create Custom Team"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={handleSubmit}>
          {team && (
            <input
              type="hidden"
              name="expectedUpdatedAt"
              value={new Date(team.updatedAt).toISOString()}
            />
          )}
          <DialogHeader>
            <DialogTitle>
              {team ? "Edit team" : "Create Custom Team"}
            </DialogTitle>
            <DialogDescription>
              {team
                ? "Correct team details or archive the team. Existing records are retained."
                : "Add a new ministry team beyond the 10 core teams."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Team Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={team?.name}
                placeholder="e.g., Outreach Team"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={team?.description ?? ""}
                placeholder="Describe the team's purpose and responsibilities..."
                rows={3}
              />
            </div>
            {team && (
              <div className="grid gap-2">
                <Label htmlFor="team-status">Status</Label>
                <select
                  id="team-status"
                  name="status"
                  defaultValue={team.status}
                  className="border-input rounded-md border p-2"
                >
                  <option value="forming">Forming</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="archived">Archived (retain history)</option>
                </select>
              </div>
            )}
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
              {loading ? "Saving..." : team ? "Save changes" : "Create Team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
