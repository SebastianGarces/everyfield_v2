"use client";

import {
  addSkillAction,
  updateSkillAction,
} from "@/app/(dashboard)/people/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "@/components/ui/textarea";
import {
  skillCategories,
  skillProficiencies,
  type SkillCategory,
  type SkillInventory,
  type SkillProficiency,
} from "@/db/schema";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

interface SkillsFormProps {
  personId: string;
  skill?: SkillInventory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  worship: "Worship",
  tech: "Technology",
  admin: "Administration",
  teaching: "Teaching",
  hospitality: "Hospitality",
  leadership: "Leadership",
  other: "Other",
};

const PROFICIENCY_LABELS: Record<SkillProficiency, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
};

const PROFICIENCY_COLORS: Record<SkillProficiency, string> = {
  beginner: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  intermediate:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  advanced:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  expert:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

export function SkillsForm({
  personId,
  skill,
  open,
  onOpenChange,
}: SkillsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEditing = !!skill;

  const [category, setCategory] = useState<SkillCategory>("other");
  const [skillName, setSkillName] = useState("");
  const [proficiency, setProficiency] = useState<SkillProficiency | "">("");
  const [notes, setNotes] = useState("");

  // Track previous open state to detect dialog opening
  const prevOpenRef = useRef(open);

  // Reset form when dialog opens or skill changes
  useEffect(() => {
    // Only reset when dialog opens (was closed, now open)
    if (open && !prevOpenRef.current) {
      // Use callback form to avoid lint warning about synchronous setState
      const resetForm = () => {
        if (skill) {
          setCategory(skill.skillCategory);
          setSkillName(skill.skillName);
          setProficiency(skill.proficiency ?? "");
          setNotes(skill.notes ?? "");
        } else {
          setCategory("other");
          setSkillName("");
          setProficiency("");
          setNotes("");
        }
      };
      // Schedule reset to next tick
      queueMicrotask(resetForm);
    }
    prevOpenRef.current = open;
  }, [open, skill]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!skillName.trim()) {
      toast.error("Please enter a skill name");
      return;
    }

    startTransition(async () => {
      const data = {
        personId,
        skillCategory: category,
        skillName: skillName.trim(),
        proficiency: proficiency || undefined,
        notes: notes.trim() || undefined,
      };

      const result = isEditing
        ? await updateSkillAction(skill.id, data)
        : await addSkillAction(data);

      if (result.success) {
        toast.success(isEditing ? "Skill updated" : "Skill added");
        router.refresh();
        onOpenChange(false);
      } else {
        toast.error(
          isEditing ? "Failed to update skill" : "Failed to add skill",
          {
            description: result.error,
          }
        );
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Skill" : "Add Skill"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as SkillCategory)}
              disabled={isPending}
            >
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {skillCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Skill Name */}
          <div className="space-y-2">
            <Label htmlFor="skillName">Skill Name</Label>
            <Input
              id="skillName"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="e.g., Guitar, Video editing, Accounting..."
              disabled={isPending}
              required
            />
          </div>

          {/* Proficiency */}
          <div className="space-y-2">
            <Label>Proficiency Level (Optional)</Label>
            <div className="grid grid-cols-2 gap-2">
              {skillProficiencies.map((prof) => (
                <button
                  key={prof}
                  type="button"
                  onClick={() =>
                    setProficiency(proficiency === prof ? "" : prof)
                  }
                  disabled={isPending}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    "hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
                    proficiency === prof
                      ? cn("ring-primary ring-2", PROFICIENCY_COLORS[prof])
                      : "border-input bg-background"
                  )}
                >
                  {PROFICIENCY_LABELS[prof]}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details about this skill..."
              disabled={isPending}
              className="min-h-[80px]"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !skillName.trim()}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Update Skill" : "Add Skill"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { CATEGORY_LABELS, PROFICIENCY_COLORS, PROFICIENCY_LABELS };
