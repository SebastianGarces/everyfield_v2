"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
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
import { deleteRoleAction } from "@/app/(dashboard)/teams/actions";

interface RoleRemoveButtonProps {
  roleId: string;
  roleName: string;
  /** Who is sitting in it, when somebody is — they lose the seat with it. */
  assigneeName?: string;
}

/**
 * Delete a role from a team (#311 WS2 amendment).
 *
 * THE CONFIRMATION SAYS WHAT ELSE GOES. Deleting a role deletes its
 * memberships with it — `team_memberships.role_id` cascades — so a planter
 * removing a filled role is unassigning somebody, and the dialog names them
 * rather than letting them vanish from the roster unannounced.
 *
 * `deleteRole` is what makes that true, not this component's ordering: it takes
 * the role and its seats in one statement, and clears the team's leader if the
 * seat was a leadership one pointing at them.
 */
export function RoleRemoveButton({
  roleId,
  roleName,
  assigneeName,
}: RoleRemoveButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRemove() {
    setLoading(true);
    try {
      const result = await deleteRoleAction(roleId);
      if (result.success) {
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive h-8 w-8 cursor-pointer"
          aria-label={`Remove the ${roleName} role`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove the {roleName} role?</AlertDialogTitle>
          <AlertDialogDescription>
            {assigneeName ? (
              <>
                <span className="font-medium">{assigneeName}</span> will be
                unassigned and the{" "}
                <span className="font-medium">{roleName}</span> role will be
                removed from this team. This cannot be undone.
              </>
            ) : (
              <>
                The <span className="font-medium">{roleName}</span> role will be
                removed from this team. This cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer" disabled={loading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              handleRemove();
            }}
            disabled={loading}
            className="cursor-pointer"
          >
            {loading ? "Removing..." : "Remove Role"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
