"use client";

import { deletePersonAction } from "@/app/(dashboard)/people/actions";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import type { Household } from "@/db/schema";
import type { PersonForClient, PersonStatus } from "@/lib/people/types";
import { useRouter } from "next/navigation";
import { useOptimistic, useState } from "react";
import { toast } from "sonner";
import { PersonEditDialog } from "./person-edit-dialog";
import { PersonHeader } from "./person-header";
import { PersonTabs } from "./person-tabs";

interface PersonProfileShellProps {
  person: PersonForClient;
  activeTab:
    | "overview"
    | "activity"
    | "assessments"
    | "teams"
    | "communication";
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
  const personName =
    [person.firstName, person.lastName].filter(Boolean).join(" ") || "Person";

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
    <PageCanvas
      contextAttachment="attached"
      contextItems={[
        { label: "People & CRM", href: "/people" },
        { label: personName },
      ]}
      scrollLayout="flow"
    >
      <WorkspacePanel className="min-h-full">
        {/* The extra wrapper gives the profile one rounded surface while the
            canvas remains the only vertical scroll owner. Dialog state and
            every action remain owned by this component. */}
        <div className="relative z-10 border-b">
          <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
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

        <div className="p-4 sm:p-6">
          <div className="mx-auto max-w-4xl space-y-6">{children}</div>
        </div>
      </WorkspacePanel>

      {/* Edit Dialog */}
      <PersonEditDialog
        person={optimisticPerson}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />
    </PageCanvas>
  );
}
