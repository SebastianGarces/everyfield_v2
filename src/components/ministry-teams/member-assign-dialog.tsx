"use client";

import { useState, useEffect } from "react";
import { Search, UserPlus, AlertTriangle } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  assignMemberAction,
  getPersonTeamCountAction,
} from "@/app/(dashboard)/teams/actions";
import type { Person } from "@/db/schema";

interface MemberAssignDialogProps {
  teamId: string;
  roleId: string;
  roleName: string;
  people: Person[];
}

export function MemberAssignDialog({
  teamId,
  roleId,
  roleName,
  people,
}: MemberAssignDialogProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [teamCount, setTeamCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredPeople = people.filter((p) => {
    const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
    return fullName.includes(search.toLowerCase());
  });

  useEffect(() => {
    if (selectedPerson) {
      getPersonTeamCountAction(selectedPerson.id).then((result) => {
        if (result.success) setTeamCount(result.data);
      });
    }
  }, [selectedPerson]);

  async function handleAssign() {
    if (!selectedPerson) return;

    setLoading(true);
    setError(null);
    try {
      const result = await assignMemberAction(teamId, roleId, {
        personId: selectedPerson.id,
      });
      if (result.success) {
        setOpen(false);
        setSelectedPerson(null);
        setSearch("");
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setSelectedPerson(null);
          setSearch("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="cursor-pointer">
          <UserPlus className="mr-1 h-3.5 w-3.5" />
          Assign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Member</DialogTitle>
          <DialogDescription>
            Assign a person to the{" "}
            <span className="font-medium">{roleName}</span> role.
          </DialogDescription>
        </DialogHeader>

        {!selectedPerson ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search people..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-64 overflow-auto rounded-md border">
              {filteredPeople.length === 0 ? (
                <div className="text-muted-foreground p-4 text-center text-sm">
                  No people found
                </div>
              ) : (
                filteredPeople.map((person) => {
                  const initials = `${person.firstName[0]}${person.lastName[0]}`.toUpperCase();
                  return (
                    <button
                      key={person.id}
                      type="button"
                      className="hover:bg-muted flex w-full cursor-pointer items-center gap-3 border-b p-3 text-left last:border-b-0"
                      onClick={() => setSelectedPerson(person)}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {person.firstName} {person.lastName}
                        </p>
                        {person.email && (
                          <p className="text-muted-foreground truncate text-xs">
                            {person.email}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {person.status.replace("_", " ")}
                      </Badge>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <Avatar className="h-10 w-10">
                <AvatarFallback>
                  {`${selectedPerson.firstName[0]}${selectedPerson.lastName[0]}`.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">
                  {selectedPerson.firstName} {selectedPerson.lastName}
                </p>
                <p className="text-muted-foreground text-sm">
                  {selectedPerson.email ?? "No email"}
                </p>
              </div>
            </div>

            {teamCount >= 2 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This person is already on {teamCount} team
                  {teamCount !== 1 ? "s" : ""}. Consider whether additional
                  assignments are manageable.
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedPerson(null)}
              className="cursor-pointer"
            >
              Choose different person
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          {selectedPerson && (
            <Button
              onClick={handleAssign}
              disabled={loading}
              className="cursor-pointer"
            >
              {loading ? "Assigning..." : "Confirm Assignment"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
