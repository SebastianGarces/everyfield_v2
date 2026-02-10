"use client";

import { CheckCircle2, Circle, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TEAM_TEMPLATES,
  type TeamTemplate,
} from "@/lib/ministry-teams/role-templates";

interface ResponsibilitiesTabProps {
  teamName: string;
}

/**
 * Derives responsibility items from the team template description.
 * In a future iteration, these could be stored in the database
 * as checklist items with status tracking.
 */
function getTeamResponsibilities(teamName: string): string[] {
  const template = TEAM_TEMPLATES.find(
    (t) => t.teamName.toLowerCase() === teamName.toLowerCase()
  );

  if (!template) return [];

  // Split the description by comma to get individual responsibilities
  return template.description
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

export function ResponsibilitiesTab({ teamName }: ResponsibilitiesTabProps) {
  const responsibilities = getTeamResponsibilities(teamName);

  if (responsibilities.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-8 text-center">
          <Circle className="text-muted-foreground h-10 w-10" />
          <h3 className="mt-3 font-medium">No responsibilities defined</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            This is a custom team. Responsibilities tracking will be available
            in a future update.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Responsibilities ({responsibilities.length})
        </h2>
        <Badge variant="outline" className="text-xs">
          From Launch Playbook
        </Badge>
      </div>

      <div className="space-y-2">
        {responsibilities.map((responsibility, index) => (
          <Card key={index} className="py-0">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <Circle className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium capitalize">
                  {responsibility}
                </p>
              </div>
              <Badge variant="secondary" className="text-xs">
                Not Started
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        Status tracking for individual responsibilities is planned for a future
        release. Currently showing responsibilities from the Launch Playbook
        template.
      </p>
    </div>
  );
}
