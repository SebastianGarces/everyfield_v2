import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AttendanceType } from "@/db/schema";
import type { AttendanceWithPerson } from "@/lib/vision-meetings/types";
import { X } from "lucide-react";

interface AttendeeRowProps {
  attendee: AttendanceWithPerson;
  onRemove: () => void;
  disabled?: boolean;
}

const typeBadgeColors: Record<AttendanceType, string> = {
  first_time:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  returning: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  core_group:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
};

const typeLabels: Record<AttendanceType, string> = {
  first_time: "First Time",
  returning: "Returning",
  core_group: "Core Group",
};

export function AttendeeRow({
  attendee,
  onRemove,
  disabled,
}: AttendeeRowProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        <div>
          <p className="text-sm font-medium">
            {attendee.person.firstName} {attendee.person.lastName}
          </p>
          {attendee.invitedBy && (
            <p className="text-muted-foreground text-xs">
              Invited by {attendee.invitedBy.firstName}{" "}
              {attendee.invitedBy.lastName}
            </p>
          )}
        </div>
        <Badge
          className={typeBadgeColors[attendee.attendanceType]}
          variant="secondary"
        >
          {typeLabels[attendee.attendanceType]}
        </Badge>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={disabled}
        className="text-muted-foreground hover:text-destructive h-8 w-8 cursor-pointer"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
