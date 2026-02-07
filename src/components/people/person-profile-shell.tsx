"use client";

import { deletePersonAction } from "@/app/(dashboard)/people/actions";
import type { Household } from "@/db/schema";
import type { Person, PersonStatus } from "@/lib/people/types";
import { useRouter } from "next/navigation";
import { useOptimistic, useState } from "react";
import { toast } from "sonner";
import { PersonEditDialog } from "./person-edit-dialog";
import { PersonHeader } from "./person-header";
import { PersonTabs } from "./person-tabs";

interface PersonProfileShellProps {
  person: Person;
  activeTab: "overview" | "activity" | "assessments" | "teams";
  household?: Household | null;
  children: React.ReactNode;
}

export function PersonProfileShell({
  person,
  activeTab,
  household,
  children,
}: PersonProfileShellProps) {
  const router = useRouter();
  const [isEditOpen, setIsEditOpen] = useState(false);

  const [optimisticPerson, updateOptimisticPerson] = useOptimistic(
    person,
    (currentPerson, newStatus: PersonStatus) => ({
      ...currentPerson,
      status: newStatus,
    })
  );

  const handleDelete = async () => {
    const result = await deletePersonAction(person.id);
    if (result.success) {
      toast.success("Person deleted successfully");
      router.push("/people");
    } else {
      toast.error("Failed to delete", {
        description: result.error,
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header hero panel */}
      <div className="bg-card relative z-10 shadow-sm">
        <div className="mx-auto max-w-4xl space-y-6 p-6">
          <PersonHeader
            person={optimisticPerson}
            household={household ?? null}
            onEdit={() => setIsEditOpen(true)}
            onDelete={handleDelete}
            onOptimisticStatusChange={updateOptimisticPerson}
          />
          <PersonTabs personId={person.id} activeTab={activeTab} />
        </div>
      </div>

      {/* Content area on gray canvas */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">{children}</div>
      </div>

      {/* Edit Dialog */}
      <PersonEditDialog
        person={optimisticPerson}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />
    </div>
  );
}
