"use client";

import { PersonForm } from "@/components/people/person-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Person } from "@/lib/people/types";

interface PersonEditDialogProps {
  person: Person;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PersonEditDialog({
  person,
  open,
  onOpenChange,
}: PersonEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Person</DialogTitle>
        </DialogHeader>
        <PersonForm
          person={person}
          mode="edit"
          onSuccess={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
