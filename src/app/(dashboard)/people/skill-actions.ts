"use server";

import type {
  SkillCategory,
  SkillInventory,
  SkillProficiency,
} from "@/db/schema";
import { logPersonActivity } from "@/lib/people/activity";
import { assertPersonInChurch } from "@/lib/people/service";
import {
  addSkill,
  getPersonSkills,
  getSkill,
  removeSkill,
  updateSkill,
} from "@/lib/people/skills";
import type { ActionResult } from "@/lib/people/types";
import { skillCreateSchema } from "@/lib/validations/people";
import { revalidatePath } from "next/cache";
import { toFieldErrors, withChurchSession } from "./action-context";

/**
 * Add a skill to a person
 */
export async function addSkillAction(data: {
  personId: string;
  skillCategory: string;
  skillName: string;
  proficiency?: string;
  notes?: string;
}): Promise<ActionResult<SkillInventory>> {
  return withChurchSession(
    "addSkillAction",
    {
      known: { "Person not found": "Person not found" },
      fallback: "Failed to add skill",
    },
    async ({ user, churchId }) => {
      const parsed = skillCreateSchema.safeParse(data);
      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      // Never write against a personId the caller's church does not own
      await assertPersonInChurch(churchId, parsed.data.personId);

      const skill = await addSkill(churchId, parsed.data);

      // Log activity
      await logPersonActivity(
        churchId,
        data.personId,
        "skill_added",
        {
          skillName: skill.skillName,
          skillCategory: skill.skillCategory,
          proficiency: skill.proficiency,
        },
        user.id
      );

      revalidatePath(`/people/${data.personId}`);
      return { success: true, data: skill };
    }
  );
}

/**
 * Update an existing skill
 */
export async function updateSkillAction(
  skillId: string,
  data: {
    skillCategory?: SkillCategory;
    skillName?: string;
    proficiency?: SkillProficiency | null;
    notes?: string | null;
  }
): Promise<ActionResult<SkillInventory>> {
  return withChurchSession(
    "updateSkillAction",
    {
      known: { "Skill not found": "Skill not found" },
      fallback: "Failed to update skill",
    },
    async ({ user, churchId }) => {
      // Get existing skill for activity logging
      const existingSkill = await getSkill(churchId, skillId);
      if (!existingSkill) {
        return { success: false, error: "Skill not found" };
      }

      const skill = await updateSkill(churchId, skillId, {
        skillCategory: data.skillCategory,
        skillName: data.skillName,
        proficiency: data.proficiency,
        notes: data.notes,
      });

      // Log activity
      await logPersonActivity(
        churchId,
        skill.personId,
        "skill_updated",
        {
          skillName: skill.skillName,
          skillCategory: skill.skillCategory,
          proficiency: skill.proficiency,
          previousName:
            existingSkill.skillName !== skill.skillName
              ? existingSkill.skillName
              : undefined,
          previousProficiency:
            existingSkill.proficiency !== skill.proficiency
              ? existingSkill.proficiency
              : undefined,
        },
        user.id
      );

      revalidatePath("/people");
      return { success: true, data: skill };
    }
  );
}

/**
 * Remove a skill from a person
 */
export async function removeSkillAction(
  skillId: string
): Promise<ActionResult<void>> {
  return withChurchSession(
    "removeSkillAction",
    {
      known: { "Skill not found": "Skill not found" },
      fallback: "Failed to remove skill",
    },
    async ({ user, churchId }) => {
      // Get skill info before deletion for activity logging
      const skill = await getSkill(churchId, skillId);
      if (!skill) {
        return { success: false, error: "Skill not found" };
      }

      await removeSkill(churchId, skillId);

      // Log activity
      await logPersonActivity(
        churchId,
        skill.personId,
        "skill_removed",
        {
          skillName: skill.skillName,
          skillCategory: skill.skillCategory,
        },
        user.id
      );

      revalidatePath("/people");
      return { success: true, data: undefined };
    }
  );
}

/**
 * Get all skills for a person
 */
export async function getPersonSkillsAction(
  personId: string
): Promise<ActionResult<SkillInventory[]>> {
  return withChurchSession(
    "getPersonSkillsAction",
    { fallback: "Failed to get skills" },
    async ({ churchId }) => {
      const skills = await getPersonSkills(churchId, personId);
      return { success: true, data: skills };
    }
  );
}
