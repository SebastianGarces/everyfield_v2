"use client";

import {
  createPersonAction,
  updatePersonAction,
} from "@/app/(dashboard)/people/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  ActionResult,
  PersonSource,
  PersonStatus,
} from "@/lib/people/types";
import { personSources, personStatuses, type Person } from "@/lib/people/types";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

// Format enum values for display
function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface PersonFormProps {
  person?: Person;
  mode: "create" | "edit";
  onSuccess?: () => void;
  onCancel?: () => void;
}

type FormState = ActionResult<Person> | null;

export function PersonForm({
  person,
  mode,
  onSuccess,
  onCancel,
}: PersonFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const hasCalledSuccess = useRef(false);

  // Controlled state for Select components (Radix Select doesn't work with native FormData)
  // In edit mode, we don't allow status changes through this form
  const [status, setStatus] = useState<PersonStatus>(
    person?.status ?? "prospect"
  );
  const [source, setSource] = useState<PersonSource | "">(person?.source ?? "");

  const action = async (
    _prevState: FormState,
    formData: FormData
  ): Promise<FormState> => {
    if (isEdit && person) {
      // In edit mode, remove status from formData to prevent changes through this form
      // Status should only be changed via the dedicated "Change Status" modal
      formData.delete("status");
      return updatePersonAction(person.id, formData);
    }
    return createPersonAction(formData);
  };

  const [state, formAction, isPending] = useActionState(action, null);

  // Handle success - use ref to prevent multiple calls
  useEffect(() => {
    if (state?.success && !hasCalledSuccess.current) {
      hasCalledSuccess.current = true;
      if (onSuccess) {
        onSuccess();
      } else {
        router.push("/people");
      }
    }
  }, [state, router, onSuccess]);

  // Reset the ref when form is reset
  useEffect(() => {
    if (!state) {
      hasCalledSuccess.current = false;
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.success && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name *</Label>
          <Input
            id="firstName"
            name="firstName"
            defaultValue={person?.firstName ?? ""}
            required
            placeholder="John"
          />
          {state && !state.success && state.fieldErrors?.firstName && (
            <p className="text-destructive text-sm">
              {state.fieldErrors.firstName[0]}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name *</Label>
          <Input
            id="lastName"
            name="lastName"
            defaultValue={person?.lastName ?? ""}
            required
            placeholder="Doe"
          />
          {state && !state.success && state.fieldErrors?.lastName && (
            <p className="text-destructive text-sm">
              {state.fieldErrors.lastName[0]}
            </p>
          )}
        </div>

        {/* Contact */}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={person?.email ?? ""}
            placeholder="john@example.com"
          />
          {state && !state.success && state.fieldErrors?.email && (
            <p className="text-destructive text-sm">
              {state.fieldErrors.email[0]}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={person?.phone ?? ""}
            placeholder="(555) 123-4567"
          />
        </div>

        {/* Status & Source */}
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          {isEdit ? (
            // In edit mode, show current status as read-only
            // Status changes should be done via the "Change Status" button
            <div className="space-y-1">
              <div className="bg-muted text-muted-foreground flex h-9 items-center rounded-md border px-3 text-sm">
                {formatEnumLabel(person?.status ?? "prospect")}
              </div>
              <p className="text-muted-foreground text-xs">
                Use the "Change Status" button in the header to update status
              </p>
            </div>
          ) : (
            // In create mode, allow status selection
            <>
              <input type="hidden" name="status" value={status} />
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as PersonStatus)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {personStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {formatEnumLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="source">Source</Label>
          <input type="hidden" name="source" value={source} />
          <Select
            value={source || undefined}
            onValueChange={(value) => setSource(value as PersonSource)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent>
              {personSources.map((s) => (
                <SelectItem key={s} value={s}>
                  {formatEnumLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Address */}
      <div className="space-y-4">
        <h3 className="text-muted-foreground text-sm font-medium">Address</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="addressLine1">Street Address</Label>
            <Input
              id="addressLine1"
              name="addressLine1"
              defaultValue={person?.addressLine1 ?? ""}
              placeholder="123 Main St"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="addressLine2">Apt, Suite, etc.</Label>
            <Input
              id="addressLine2"
              name="addressLine2"
              defaultValue={person?.addressLine2 ?? ""}
              placeholder="Apt 4B"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              name="city"
              defaultValue={person?.city ?? ""}
              placeholder="New York"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              name="state"
              defaultValue={person?.state ?? ""}
              placeholder="NY"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="postalCode">ZIP Code</Label>
            <Input
              id="postalCode"
              name="postalCode"
              defaultValue={person?.postalCode ?? ""}
              placeholder="10001"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              name="country"
              defaultValue={person?.country ?? "US"}
              placeholder="US"
            />
          </div>
        </div>
      </div>

      {/* Source Details */}
      <div className="space-y-2">
        <Label htmlFor="sourceDetails">Source Details</Label>
        <Input
          id="sourceDetails"
          name="sourceDetails"
          defaultValue={person?.sourceDetails ?? ""}
          placeholder="e.g., Referred by Jane Smith"
        />
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={person?.notes ?? ""}
          placeholder="Additional notes..."
          rows={4}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-4">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? "Save Changes" : "Create Person"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => (onCancel ? onCancel() : router.back())}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
