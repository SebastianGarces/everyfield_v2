"use client";

import {
  checkForDuplicatesAction,
  quickAddPersonAction,
} from "@/app/(dashboard)/people/actions";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { personSources, type DuplicateCheck } from "@/lib/people/types";
import { Loader2, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { DuplicateWarning } from "./duplicate-warning";

// Format enum values for display
function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface QuickAddFormProps {
  children?: React.ReactNode;
}

export function QuickAddForm({ children }: QuickAddFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [duplicates, setDuplicates] = useState<DuplicateCheck | null>(null);
  const [skipDuplicateCheck, setSkipDuplicateCheck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Track which submit action triggered
  const actionRef = useRef<"save" | "saveAndAdd">("save");

  function resetForm() {
    formRef.current?.reset();
    setDuplicates(null);
    setSkipDuplicateCheck(false);
    setError(null);
    setFieldErrors({});
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      resetForm();
    }
    setOpen(newOpen);
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    const data = {
      firstName: formData.get("firstName") as string,
      lastName: formData.get("lastName") as string,
      email: (formData.get("email") as string) || undefined,
      phone: (formData.get("phone") as string) || undefined,
      source: (formData.get("source") as string) || undefined,
    };

    startTransition(async () => {
      // Step 1: Check for duplicates (unless user chose to skip)
      if (!skipDuplicateCheck) {
        const dupResult = await checkForDuplicatesAction(data);
        if (dupResult.success) {
          const { exactMatch, potentialMatches } = dupResult.data;
          if (exactMatch || potentialMatches.length > 0) {
            setDuplicates(dupResult.data);
            return; // Show duplicate warning, don't create yet
          }
        }
      }

      // Step 2: Create the person
      const result = await quickAddPersonAction(data);

      if (!result.success) {
        setError(result.error);
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
        }
        return;
      }

      // Success
      toast.success("Person added", {
        description: `${result.data.firstName} ${result.data.lastName} has been added.`,
      });

      router.refresh();

      if (actionRef.current === "saveAndAdd") {
        // Clear form but keep dialog open
        resetForm();
        // Focus the first input after a tick
        setTimeout(() => firstInputRef.current?.focus(), 50);
      } else {
        // Close dialog
        handleOpenChange(false);
      }
    });
  }

  function handleCreateAnyway() {
    setSkipDuplicateCheck(true);
    setDuplicates(null);
    // Re-submit the form
    if (formRef.current) {
      const formData = new FormData(formRef.current);
      handleSubmit(formData);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <Zap className="mr-2 h-4 w-4" />
            Quick Add
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick Add Person</DialogTitle>
          <DialogDescription>
            Add a new contact with minimal info.{" "}
            <Link
              href="/people/new"
              className="text-primary hover:underline"
              onClick={() => handleOpenChange(false)}
            >
              Full Form &rarr;
            </Link>
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          action={(formData) => handleSubmit(formData)}
          className="space-y-4"
        >
          {/* Name row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qa-firstName">
                First Name <span className="text-destructive">*</span>
              </Label>
              <Input
                ref={firstInputRef}
                id="qa-firstName"
                name="firstName"
                required
                autoFocus
                placeholder="First name"
              />
              {fieldErrors.firstName && (
                <p className="text-destructive text-xs">
                  {fieldErrors.firstName[0]}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qa-lastName">
                Last Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="qa-lastName"
                name="lastName"
                required
                placeholder="Last name"
              />
              {fieldErrors.lastName && (
                <p className="text-destructive text-xs">
                  {fieldErrors.lastName[0]}
                </p>
              )}
            </div>
          </div>

          {/* Contact row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qa-email">Email</Label>
              <Input
                id="qa-email"
                name="email"
                type="email"
                placeholder="email@example.com"
              />
              {fieldErrors.email && (
                <p className="text-destructive text-xs">
                  {fieldErrors.email[0]}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qa-phone">Phone</Label>
              <Input
                id="qa-phone"
                name="phone"
                type="tel"
                placeholder="555-0123"
              />
            </div>
          </div>

          {/* Source */}
          <div className="space-y-2">
            <Label htmlFor="qa-source">Source</Label>
            <Select name="source" defaultValue="other">
              <SelectTrigger id="qa-source">
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                {personSources.map((source) => (
                  <SelectItem key={source} value={source}>
                    {formatEnumLabel(source)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Error message */}
          {error && <p className="text-destructive text-sm">{error}</p>}

          {/* Duplicate warning */}
          {duplicates && (
            <DuplicateWarning
              duplicates={duplicates}
              onCreateAnyway={handleCreateAnyway}
              isSubmitting={isPending}
            />
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                actionRef.current = "saveAndAdd";
              }}
            >
              {isPending && actionRef.current === "saveAndAdd" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save & Add Another
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              onClick={() => {
                actionRef.current = "save";
              }}
            >
              {isPending && actionRef.current === "save" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
