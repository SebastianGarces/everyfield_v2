"use client";

import { quickAddAttendeeAction } from "@/app/(dashboard)/vision-meetings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

interface AttendeeQuickAddProps {
  meetingId: string;
  onClose: () => void;
}

export function AttendeeQuickAdd({
  meetingId,
  onClose,
}: AttendeeQuickAddProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await quickAddAttendeeAction(meetingId, formData);
      if (result.success) {
        router.refresh();
        onClose();
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-muted/30 space-y-4 rounded-lg border p-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name *</Label>
          <Input
            id="firstName"
            name="firstName"
            required
            placeholder="First name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name *</Label>
          <Input
            id="lastName"
            name="lastName"
            required
            placeholder="Last name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="Email address"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" placeholder="Phone number" />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Button
          type="submit"
          disabled={isPending}
          size="sm"
          className="cursor-pointer"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add Attendee
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="cursor-pointer"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
