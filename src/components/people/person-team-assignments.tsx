import Link from "next/link";
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PersonTeamAssignment } from "@/lib/ministry-teams/service";

import {
  formatCalendarDate,
  sortTeamAssignments,
} from "./person-teams-presentation";

interface PersonTeamAssignmentsProps {
  assignments: PersonTeamAssignment[];
}

/**
 * The person profile's Team Assignments card: every ministry team this person
 * currently serves on, with the role they hold there.
 */
export function PersonTeamAssignments({
  assignments,
}: PersonTeamAssignmentsProps) {
  const sorted = sortTeamAssignments(assignments);

  return (
    <Card data-testid="person-team-assignments">
      <CardHeader>
        <CardTitle>Team Assignments</CardTitle>
        <CardDescription>
          {sorted.length === 0
            ? "Ministry teams this person serves on"
            : `Serving on ${sorted.length} team${sorted.length === 1 ? "" : "s"}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-6 text-center"
            data-testid="person-team-assignments-empty"
          >
            <Users className="text-muted-foreground h-8 w-8" aria-hidden />
            <p className="mt-3 font-medium">Not on a team yet</p>
            <p className="text-muted-foreground mt-1 max-w-xs text-sm text-balance">
              Assign this person to a role from a team&apos;s Members &amp;
              Roles tab and it will show up here.
            </p>
            <Link
              href="/teams"
              className="text-primary mt-3 cursor-pointer text-sm font-medium underline-offset-4 hover:underline"
            >
              Browse ministry teams
            </Link>
          </div>
        ) : (
          <ul className="divide-border divide-y">
            {sorted.map((assignment) => {
              const startedOn = formatCalendarDate(assignment.startDate);

              return (
                <li
                  key={assignment.membershipId}
                  className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/teams/${assignment.teamId}`}
                      className="cursor-pointer font-medium underline-offset-4 hover:underline"
                    >
                      {assignment.teamName}
                    </Link>
                    <p className="text-muted-foreground truncate text-sm">
                      {assignment.roleName}
                      {startedOn ? ` · since ${startedOn}` : ""}
                    </p>
                  </div>
                  <Badge variant="secondary" className="capitalize">
                    {assignment.status}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
