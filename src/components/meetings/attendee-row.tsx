import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AttendanceWithPerson } from "@/lib/meetings/types";
import type { AttendanceType } from "@/db/schema";

interface AttendeeRowProps {
  attendee: AttendanceWithPerson;
  onRemove: () => void;
  disabled?: boolean;
}

const typeBadgeColors: Record<AttendanceType, string> = {
  first_time:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  returning:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  core_group:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
};

const typeLabels: Record<AttendanceType, string> = {
  first_time: "First Time",
  returning: "Returning",
  core_group: "Core Group",
};

export function AttendeeRow({ attendee, onRemove, disabled }: AttendeeRowProps) {
  // Default to first_time if null (though schema should enforce it, types might be loose)
  const type = attendee.attendanceType ?? "first_time";

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-sm font-medium">
            {attendee.person.firstName} {attendee.person.lastName}
          </p>
          {attendee.invitedBy && (
            <p className="text-xs text-muted-foreground">
              Invited by {attendee.invitedBy.firstName}{" "}
              {attendee.invitedBy.lastName}
            </p>
          )}
        </div>
        <Badge
          className={typeBadgeColors[type]}
          variant="secondary"
        >
          {typeLabels[type]}
        </Badge>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={disabled}
        className="h-8 w-8 cursor-pointer text-muted-foreground hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
