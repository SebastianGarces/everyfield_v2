"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Household, HouseholdRole, Person } from "@/db/schema";
import { Settings, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { HouseholdManager } from "./household-manager";

interface HouseholdMembersProps {
  person: Person;
  household: Household | null;
  members: Person[];
}

const ROLE_LABELS: Record<HouseholdRole, string> = {
  head: "Head",
  spouse: "Spouse",
  child: "Child",
  other: "Member",
};

function getInitials(person: Person): string {
  return `${person.firstName[0] || ""}${person.lastName[0] || ""}`.toUpperCase();
}

export function HouseholdMembers({
  person,
  household,
  members,
}: HouseholdMembersProps) {
  const [managerOpen, setManagerOpen] = useState(false);

  // Filter out the current person from the members list for display
  const otherMembers = members.filter((m) => m.id !== person.id);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-semibold">Family Members</CardTitle>
          {household && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setManagerOpen(true)}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {household ? (
            otherMembers.length > 0 ? (
              <div className="space-y-1">
                {otherMembers.slice(0, 4).map((member) => (
                  <Link
                    key={member.id}
                    href={`/people/${member.id}`}
                    className="hover:bg-muted flex items-center gap-3 rounded-md p-2 transition-colors"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {getInitials(member)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {member.firstName} {member.lastName}
                      </p>
                      {member.householdRole && (
                        <p className="text-muted-foreground text-xs">
                          {ROLE_LABELS[member.householdRole]}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
                {otherMembers.length > 4 && (
                  <p className="text-muted-foreground pl-2 text-sm">
                    +{otherMembers.length - 4} more
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No other members in this household
              </p>
            )
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setManagerOpen(true)}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Connect Family
            </Button>
          )}
        </CardContent>
      </Card>

      <HouseholdManager
        person={person}
        currentHousehold={household}
        open={managerOpen}
        onOpenChange={setManagerOpen}
      />
    </>
  );
}
