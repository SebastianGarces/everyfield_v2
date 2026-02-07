"use client";

import { removeSkillAction } from "@/app/(dashboard)/people/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SkillCategory, SkillInventory } from "@/db/schema";
import { cn } from "@/lib/utils";
import { Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CATEGORY_LABELS,
  PROFICIENCY_COLORS,
  PROFICIENCY_LABELS,
  SkillsForm,
} from "./skills-form";

interface SkillsListProps {
  personId: string;
  skills: SkillInventory[];
}

const CATEGORY_ICONS: Record<SkillCategory, string> = {
  worship: "🎵",
  tech: "💻",
  admin: "📋",
  teaching: "📚",
  hospitality: "🏠",
  leadership: "⭐",
  other: "🔧",
};

function groupSkillsByCategory(
  skills: SkillInventory[]
): Record<SkillCategory, SkillInventory[]> {
  return skills.reduce(
    (acc, skill) => {
      const category = skill.skillCategory;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(skill);
      return acc;
    },
    {} as Record<SkillCategory, SkillInventory[]>
  );
}

export function SkillsList({ personId, skills }: SkillsListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillInventory | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<SkillInventory | null>(
    null
  );

  const groupedSkills = groupSkillsByCategory(skills);
  const categories = Object.keys(groupedSkills) as SkillCategory[];

  const handleEdit = (skill: SkillInventory) => {
    setEditingSkill(skill);
    setFormOpen(true);
  };

  const handleDelete = (skill: SkillInventory) => {
    setDeletingSkill(skill);
  };

  const confirmDelete = () => {
    if (!deletingSkill) return;

    startTransition(async () => {
      const result = await removeSkillAction(deletingSkill.id);

      if (result.success) {
        toast.success("Skill removed");
        router.refresh();
      } else {
        toast.error("Failed to remove skill", {
          description: result.error,
        });
      }
      setDeletingSkill(null);
    });
  };

  const handleOpenForm = () => {
    setEditingSkill(null);
    setFormOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base font-semibold">Skills & Gifts</CardTitle>
          <Sparkles className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          {skills.length === 0 ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                No skills recorded yet
              </p>
              <Button variant="outline" size="sm" onClick={handleOpenForm}>
                <Plus className="mr-1 h-3 w-3" />
                Add Skill
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {categories.map((category) => (
                <div key={category} className="space-y-2">
                  <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                    <span>{CATEGORY_ICONS[category]}</span>
                    <span>{CATEGORY_LABELS[category]}</span>
                  </div>
                  <div className="space-y-1.5 pl-6">
                    {groupedSkills[category].map((skill) => (
                      <div
                        key={skill.id}
                        className="group hover:bg-muted/50 -ml-1.5 flex items-center justify-between rounded-md p-1.5"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm">
                            {skill.skillName}
                          </span>
                          {skill.proficiency && (
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-xs",
                                PROFICIENCY_COLORS[skill.proficiency]
                              )}
                            >
                              {PROFICIENCY_LABELS[skill.proficiency]}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleEdit(skill)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive h-7 w-7"
                            onClick={() => handleDelete(skill)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenForm}
                className="mt-2"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add Skill
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <SkillsForm
        personId={personId}
        skill={editingSkill}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      <AlertDialog
        open={!!deletingSkill}
        onOpenChange={(open) => !open && setDeletingSkill(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Skill</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove &quot;{deletingSkill?.skillName}
              &quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
