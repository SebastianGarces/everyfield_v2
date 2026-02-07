"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Household } from "@/db/schema";
import { STATUS_BADGE_CONFIG } from "@/lib/people/status-colors";
import type { Person, PersonStatus } from "@/lib/people/types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  ArrowRightLeft,
  Calendar,
  MoreHorizontal,
  Pencil,
  Rocket,
  Star,
  Trash,
} from "lucide-react";
import { useState } from "react";
import { StatusChangeModal } from "./status-change-modal";

interface PersonHeaderProps {
  person: Person;
  household?: Household | null;
  onEdit: () => void;
  onDelete: () => void;
  onOptimisticStatusChange?: (newStatus: PersonStatus) => void;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  rocket: <Rocket className="h-3 w-3" />,
  star: <Star className="h-3 w-3" />,
};

export function PersonHeader({
  person,
  household,
  onEdit,
  onDelete,
  onOptimisticStatusChange,
}: PersonHeaderProps) {
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const initials = `${person.firstName[0]}${person.lastName[0]}`.toUpperCase();
  const fullName = `${person.firstName} ${person.lastName}`;

  const config = STATUS_BADGE_CONFIG[person.status as PersonStatus];

  const statusBadge = config ? (
    <Badge variant={config.variant} className={cn(config.className)}>
      {config.icon && STATUS_ICONS[config.icon]}
      {config.label}
    </Badge>
  ) : (
    <Badge variant="outline">{person.status}</Badge>
  );

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-4">
        <Avatar className="border-background h-16 w-16 border-2 shadow-sm">
          <AvatarImage src={person.photoUrl ?? undefined} alt={fullName} />
          <AvatarFallback className="text-lg font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{fullName}</h1>
            {statusBadge}
          </div>
          {household && (
            <p className="text-muted-foreground text-sm">{household.name}</p>
          )}
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <Calendar className="h-3 w-3" />
            <span>
              Joined on{" "}
              {person.createdAt
                ? format(new Date(person.createdAt), "MMM d, yyyy")
                : "Unknown"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">More actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsStatusModalOpen(true)}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Change Status
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash className="mr-2 h-4 w-4" />
                  Delete Person
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete{" "}
                    <span className="font-semibold">{fullName}</span> and remove
                    their data from our servers.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status Change Modal */}
      <StatusChangeModal
        person={person}
        open={isStatusModalOpen}
        onOpenChange={setIsStatusModalOpen}
        onOptimisticUpdate={onOptimisticStatusChange}
      />
    </div>
  );
}
