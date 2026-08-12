"use client";

import {
  addToHouseholdAction,
  createHouseholdFromPersonAction,
  createHouseholdWithHeadAction,
  propagateAddressAction,
  removeFromHouseholdAction,
} from "@/app/(dashboard)/people/household-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Household, HouseholdRole, Person } from "@/db/schema";
import { householdRoles } from "@/db/schema";
import { cn } from "@/lib/utils";
import { Home, Loader2, MapPin, Plus, UserMinus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface HouseholdManagerProps {
  person: Person;
  currentHousehold: Household | null;
  /** All households of the church, fetched server-side and passed down */
  households: Household[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_LABELS: Record<HouseholdRole, string> = {
  head: "Head of Household",
  spouse: "Spouse",
  child: "Child",
  other: "Other",
};

type Mode = "view" | "create" | "join";

/**
 * Wrapper that keeps `DialogContent` rendered unconditionally so Radix can
 * play the exit animation. Radix unmounts the portal's children once the
 * close animation finishes, so every piece of the body's form state is fresh
 * by construction on each open — no reset effect, no prevOpenRef bookkeeping.
 */
export function HouseholdManager({
  person,
  currentHousehold,
  households,
  open,
  onOpenChange,
}: HouseholdManagerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <HouseholdManagerBody
          person={person}
          currentHousehold={currentHousehold}
          households={households}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function HouseholdManagerBody({
  person,
  currentHousehold,
  households,
  onOpenChange,
}: Omit<HouseholdManagerProps, "open">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("view");

  // Form state for creating household
  const [newHouseholdName, setNewHouseholdName] = useState(
    `${person.lastName} Household`
  );
  const [usePersonAddress, setUsePersonAddress] = useState(true);

  // Form state for joining household
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<HouseholdRole>(
    person.householdRole ?? "other"
  );

  // Filter out current household if person is already in one
  const availableHouseholds = currentHousehold
    ? households.filter((h) => h.id !== currentHousehold.id)
    : households;

  const handleCreateHousehold = () => {
    startTransition(async () => {
      if (usePersonAddress) {
        const result = await createHouseholdFromPersonAction(
          person.id,
          newHouseholdName
        );
        if (!result.success) {
          toast.error("Failed to create household", {
            description: result.error,
          });
          return;
        }
      } else {
        // One atomic action: household + head land together or not at all,
        // so "created household but failed to add person" cannot happen.
        const result = await createHouseholdWithHeadAction(
          person.id,
          newHouseholdName
        );
        if (!result.success) {
          toast.error("Failed to create household", {
            description: result.error,
          });
          return;
        }
      }

      toast.success("Household created", {
        description: `${newHouseholdName} has been created.`,
      });
      router.refresh();
      onOpenChange(false);
    });
  };

  const handleJoinHousehold = () => {
    if (!selectedHouseholdId) {
      toast.error("Please select a household");
      return;
    }

    startTransition(async () => {
      const result = await addToHouseholdAction(
        person.id,
        selectedHouseholdId,
        selectedRole
      );

      if (result.success) {
        toast.success("Joined household", {
          description: `${person.firstName} has been added to the household.`,
        });
        router.refresh();
        onOpenChange(false);
      } else {
        toast.error("Failed to join household", {
          description: result.error,
        });
      }
    });
  };

  const handleRemoveFromHousehold = () => {
    startTransition(async () => {
      const result = await removeFromHouseholdAction(person.id);

      if (result.success) {
        toast.success("Removed from household", {
          description: `${person.firstName} has been removed from the household.`,
        });
        router.refresh();
        onOpenChange(false);
      } else {
        toast.error("Failed to remove from household", {
          description: result.error,
        });
      }
    });
  };

  const handlePropagateAddress = () => {
    if (!currentHousehold) return;

    startTransition(async () => {
      const result = await propagateAddressAction(currentHousehold.id);

      if (result.success) {
        toast.success("Address updated", {
          description: `Address copied to ${result.data} household member(s).`,
        });
        router.refresh();
      } else {
        toast.error("Failed to propagate address", {
          description: result.error,
        });
      }
    });
  };

  const handleUpdateRole = (newRole: HouseholdRole) => {
    if (!currentHousehold) return;

    startTransition(async () => {
      const result = await addToHouseholdAction(
        person.id,
        currentHousehold.id,
        newRole
      );

      if (result.success) {
        toast.success("Role updated");
        router.refresh();
      } else {
        toast.error("Failed to update role", {
          description: result.error,
        });
      }
    });
  };

  const hasAddress = person.addressLine1 || person.city;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Home className="h-5 w-5" />
          Manage Household
        </DialogTitle>
        <DialogDescription>
          {currentHousehold
            ? `${person.firstName} is part of ${currentHousehold.name}`
            : `Add ${person.firstName} to a household`}
        </DialogDescription>
      </DialogHeader>

      {mode === "view" && (
        <div className="space-y-4">
          {currentHousehold ? (
            <>
              {/* Current household info */}
              <div className="bg-muted/50 rounded-lg border p-4">
                <div className="flex items-center gap-2 font-medium">
                  <Users className="h-4 w-4" />
                  {currentHousehold.name}
                </div>
                {currentHousehold.addressLine1 && (
                  <p className="text-muted-foreground mt-2 text-sm">
                    {[
                      currentHousehold.addressLine1,
                      currentHousehold.city,
                      currentHousehold.state,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}

                {/* Role selector */}
                <div className="mt-4 space-y-2">
                  <Label className="text-sm">Role in Household</Label>
                  <Select
                    value={person.householdRole ?? "other"}
                    onValueChange={(v) => handleUpdateRole(v as HouseholdRole)}
                    disabled={isPending}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {householdRoles.map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  onClick={handlePropagateAddress}
                  disabled={isPending}
                  className="justify-start"
                >
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <MapPin className="mr-2 h-4 w-4" />
                  )}
                  Copy Address to All Members
                </Button>

                <Button
                  variant="outline"
                  onClick={handleRemoveFromHousehold}
                  disabled={isPending}
                  className="text-destructive hover:text-destructive justify-start"
                >
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UserMinus className="mr-2 h-4 w-4" />
                  )}
                  Remove from Household
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* No household - show options */}
              <div className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setMode("create")}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create New Household
                </Button>

                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setMode("join")}
                >
                  <Users className="mr-2 h-4 w-4" />
                  Join Existing Household
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "create" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="householdName">Household Name</Label>
            <Input
              id="householdName"
              value={newHouseholdName}
              onChange={(e) => setNewHouseholdName(e.target.value)}
              placeholder="Smith Household"
              disabled={isPending}
            />
          </div>

          {hasAddress && (
            <div className="space-y-3">
              <Label>Address</Label>
              <RadioGroup
                value={usePersonAddress ? "use" : "empty"}
                onValueChange={(v) => setUsePersonAddress(v === "use")}
                disabled={isPending}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="use" id="use-address" />
                  <Label htmlFor="use-address" className="font-normal">
                    Use {person.firstName}&apos;s current address
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="empty" id="empty-address" />
                  <Label htmlFor="empty-address" className="font-normal">
                    Start with no address
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setMode("view")}
              disabled={isPending}
            >
              Back
            </Button>
            <Button
              onClick={handleCreateHousehold}
              disabled={isPending || !newHouseholdName.trim()}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Household
            </Button>
          </div>
        </div>
      )}

      {mode === "join" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Select Household</Label>
            {availableHouseholds.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">
                No other households available.
                <br />
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => setMode("create")}
                >
                  Create a new one instead.
                </Button>
              </p>
            ) : (
              <div className="space-y-2">
                {availableHouseholds.map((household) => (
                  <button
                    key={household.id}
                    type="button"
                    onClick={() => setSelectedHouseholdId(household.id)}
                    disabled={isPending}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors",
                      "hover:bg-muted cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
                      selectedHouseholdId === household.id
                        ? "border-primary bg-primary/5 ring-primary ring-2"
                        : "border-input"
                    )}
                  >
                    <div className="font-medium">{household.name}</div>
                    {household.addressLine1 && (
                      <div className="text-muted-foreground mt-1 text-sm">
                        {[household.city, household.state]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {availableHouseholds.length > 0 && (
            <div className="space-y-2">
              <Label>Role in Household</Label>
              <Select
                value={selectedRole}
                onValueChange={(v) => setSelectedRole(v as HouseholdRole)}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {householdRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setMode("view")}
              disabled={isPending}
            >
              Back
            </Button>
            <Button
              onClick={handleJoinHousehold}
              disabled={isPending || !selectedHouseholdId}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Join Household
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
