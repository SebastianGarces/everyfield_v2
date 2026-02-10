"use client";

import { Mail, Phone, Shield, User } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TeamDetail } from "@/lib/ministry-teams/service";
import type { Person } from "@/db/schema";
import { RoleFormDialog } from "./role-form-dialog";
import { MemberAssignDialog } from "./member-assign-dialog";
import { RoleTemplateImport } from "./role-template-import";

interface MembersRolesTabProps {
  team: TeamDetail;
  people: Person[];
}

export function MembersRolesTab({ team, people }: MembersRolesTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Roles ({team.roles.length})
        </h2>
        <div className="flex items-center gap-2">
          {team.type === "predefined" && (
            <RoleTemplateImport teamId={team.id} teamName={team.name} />
          )}
          <RoleFormDialog teamId={team.id} />
        </div>
      </div>

      {team.roles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <User className="text-muted-foreground h-10 w-10" />
            <h3 className="mt-3 font-medium">No roles defined</h3>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm">
              Import role templates for this team or add custom roles to get
              started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {team.roles.map((role) => (
            <Card key={role.id} className="py-0">
              <CardContent className="flex items-center gap-4 p-4">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    role.isLeadershipRole
                      ? "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {role.isLeadershipRole ? (
                    <Shield className="h-4 w-4" />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{role.name}</span>
                    {role.isLeadershipRole && (
                      <Badge variant="outline" className="text-xs">
                        Leadership
                      </Badge>
                    )}
                    {role.timeCommitment && (
                      <Badge variant="secondary" className="text-xs capitalize">
                        {role.timeCommitment}
                      </Badge>
                    )}
                  </div>
                  {role.description && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                      {role.description}
                    </p>
                  )}
                </div>

                {role.assignedPerson ? (
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {`${role.assignedPerson.firstName[0]}${role.assignedPerson.lastName[0]}`.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-sm">
                      <p className="font-medium">
                        {role.assignedPerson.firstName}{" "}
                        {role.assignedPerson.lastName}
                      </p>
                      <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        {role.assignedPerson.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {role.assignedPerson.email}
                          </span>
                        )}
                        {role.assignedPerson.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {role.assignedPerson.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                    >
                      Filled
                    </Badge>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-orange-600">
                      Open
                    </Badge>
                    <MemberAssignDialog
                      teamId={team.id}
                      roleId={role.id}
                      roleName={role.name}
                      people={people}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
