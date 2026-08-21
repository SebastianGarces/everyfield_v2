"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  createRoleAction,
  updateRoleAction,
} from "@/app/(dashboard)/teams/actions";
import type { TeamRole } from "@/db/schema";

interface RoleFormDialogProps {
  teamId: string;
  /** Present = EDIT this role; absent = add a new one to the team. */
  role?: TeamRole;
}

/**
 * A LEADERSHIP CHECKBOX THAT CAN BE UNTICKED (#311 WS2).
 *
 * An unticked checkbox is ABSENT from `FormData`, and `roleUpdateSchema` reads
 * an absent field as "the caller did not mention it" — which is right for every
 * other optional field and catastrophic for this one: unticking would post
 * nothing, `updateRole` would leave the flag alone, and a role could be marked
 * a leadership role but never unmarked. So the checkbox carries no `name` and a
 * hidden input posts the boolean either way, always saying which it is.
 *
 * ITS OWN COMPONENT so its state is born from `defaultChecked` on every mount.
 * Radix unmounts the dialog's contents when it closes, so re-opening after a
 * save reads the role's new value instead of the one this dialog first saw.
 */
function LeadershipRoleField({ defaultChecked }: { defaultChecked: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <div className="flex items-center space-x-2">
      <input type="hidden" name="isLeadershipRole" value={String(checked)} />
      <Checkbox
        id="isLeadershipRole"
        checked={checked}
        onCheckedChange={(next) => setChecked(next === true)}
        className="cursor-pointer"
      />
      <Label htmlFor="isLeadershipRole" className="cursor-pointer">
        This is a leadership role
      </Label>
    </div>
  );
}

/**
 * Add a role, or edit one — ONE dialog, because they are the same five fields
 * and the same validation. A second component would be a second place for the
 * leadership checkbox above to be got wrong.
 */
export function RoleFormDialog({ teamId, role }: RoleFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const editing = role !== undefined;

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    try {
      const result = role
        ? await updateRoleAction(role.id, formData)
        : await createRoleAction(teamId, formData);
      if (result.success) {
        setOpen(false);
      } else {
        // The root `<Toaster>`, not an alert in here: this dialog sits inside
        // the subtree the action's revalidate repaints
        // (`memory/invariants.md` → Client/Server Data Synchronization).
        toast.error(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-8 w-8 cursor-pointer"
            aria-label={`Edit ${role.name}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="cursor-pointer">
            <Plus className="mr-2 h-4 w-4" />
            Add Role
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form action={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Role" : "Add Role"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Change this role's details. Marking it a leadership role names whoever fills it as the team's leader."
                : "Define a new role within this ministry team."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Role Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., Drummer, Sound Tech"
                defaultValue={role?.name}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Describe this role's responsibilities..."
                defaultValue={role?.description ?? undefined}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timeCommitment">Time Commitment</Label>
              <Select
                name="timeCommitment"
                defaultValue={role?.timeCommitment ?? undefined}
              >
                <SelectTrigger className="cursor-pointer">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low" className="cursor-pointer">
                    Low
                  </SelectItem>
                  <SelectItem value="medium" className="cursor-pointer">
                    Medium
                  </SelectItem>
                  <SelectItem value="high" className="cursor-pointer">
                    High
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <LeadershipRoleField
              defaultChecked={role?.isLeadershipRole ?? false}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="cursor-pointer">
              {loading
                ? editing
                  ? "Saving..."
                  : "Adding..."
                : editing
                  ? "Save Changes"
                  : "Add Role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
