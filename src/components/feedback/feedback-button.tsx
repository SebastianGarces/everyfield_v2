"use client";

import { MessageSquarePlus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { submitFeedbackAction } from "@/app/(dashboard)/feedback/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES = [
  { value: "suggestion", label: "Suggestion" },
  { value: "bug", label: "Bug Report" },
  { value: "question", label: "Question" },
  { value: "other", label: "Other" },
] as const;

export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("suggestion");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function resetForm() {
    setCategory("suggestion");
    formRef.current?.reset();
  }

  function handleSubmit(formData: FormData) {
    formData.set("category", category);
    formData.set("pageUrl", pathname);

    startTransition(async () => {
      const result = await submitFeedbackAction(formData);

      if (result.success) {
        toast.success("Thanks for your feedback!");
        setOpen(false);
        resetForm();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <SidebarMenuButton
              tooltip="Send Feedback"
              className="cursor-pointer"
            >
              <MessageSquarePlus />
              <span>Send Feedback</span>
            </SidebarMenuButton>
          </DialogTrigger>

          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Send Feedback</DialogTitle>
              <DialogDescription>
                Help us improve EveryField. Your feedback goes directly to the
                team.
              </DialogDescription>
            </DialogHeader>

            <form ref={formRef} action={handleSubmit} className="space-y-4">
              {/* Category */}
              <div className="space-y-2">
                <label
                  htmlFor="feedback-category"
                  className="text-sm font-medium"
                >
                  Category
                </label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger
                    id="feedback-category"
                    className="cursor-pointer"
                  >
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem
                        key={c.value}
                        value={c.value}
                        className="cursor-pointer"
                      >
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label
                  htmlFor="feedback-description"
                  className="text-sm font-medium"
                >
                  Description
                </label>
                <Textarea
                  id="feedback-description"
                  name="description"
                  placeholder="Tell us what's on your mind..."
                  required
                  minLength={1}
                  maxLength={5000}
                  rows={5}
                  className="resize-y"
                />
              </div>

              {/* Page context */}
              <p className="text-muted-foreground text-xs">Page: {pathname}</p>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="cursor-pointer"
                >
                  {isPending ? "Sending..." : "Submit Feedback"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
