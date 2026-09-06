import { STATUS_LABELS } from "@/lib/people/status.shared";
import {
  isOwned,
  selectUnownedContacts,
  type FollowUpContact,
  type OpenFollowUpTask,
} from "@/lib/tasks/follow-up-ownership.shared";

/** Keep the same ownership definition as Tasks; expose names, not storage fields. */
export function followUpContactRows(
  contacts: readonly FollowUpContact[],
  tasks: readonly OpenFollowUpTask[],
  onlyUnowned: boolean
) {
  const owners = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (!task.contactId || !isOwned(task)) continue;
    const names = owners.get(task.contactId) ?? new Set<string>();
    names.add(task.ownerName ?? task.ownerEmail ?? "Unnamed member");
    owners.set(task.contactId, names);
  }
  return (onlyUnowned ? selectUnownedContacts(contacts, tasks) : contacts).map(
    (contact) => ({
      id: contact.personId,
      label: contact.name,
      facts: [
        { label: "Status", value: STATUS_LABELS[contact.status] },
        {
          label: "Follow-up owner",
          value:
            [...(owners.get(contact.personId) ?? [])].join(", ") ||
            "Needs owner",
        },
      ],
    })
  );
}
