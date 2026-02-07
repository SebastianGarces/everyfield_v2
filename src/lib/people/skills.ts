import { db } from "@/db";
import {
  skillsInventory,
  type NewSkillInventory,
  type SkillCategory,
  type SkillInventory,
  type SkillProficiency,
} from "@/db/schema";
import type { SkillCreateInput } from "@/lib/validations/people";
import { and, eq } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export interface SkillUpdateInput {
  skillCategory?: SkillCategory;
  skillName?: string;
  proficiency?: SkillProficiency | null;
  notes?: string | null;
}

export interface SkillsByCategory {
  category: SkillCategory;
  skills: SkillInventory[];
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a single skill by ID
 */
export async function getSkill(
  churchId: string,
  skillId: string
): Promise<SkillInventory | null> {
  const result = await db
    .select()
    .from(skillsInventory)
    .where(
      and(
        eq(skillsInventory.churchId, churchId),
        eq(skillsInventory.id, skillId)
      )
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all skills for a person
 */
export async function getPersonSkills(
  churchId: string,
  personId: string
): Promise<SkillInventory[]> {
  return db
    .select()
    .from(skillsInventory)
    .where(
      and(
        eq(skillsInventory.churchId, churchId),
        eq(skillsInventory.personId, personId)
      )
    )
    .orderBy(skillsInventory.skillCategory, skillsInventory.skillName);
}

/**
 * Get skills for a person grouped by category
 */
export async function getPersonSkillsByCategory(
  churchId: string,
  personId: string
): Promise<SkillsByCategory[]> {
  const skills = await getPersonSkills(churchId, personId);

  // Group skills by category
  const grouped = skills.reduce(
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

  // Convert to array format
  return Object.entries(grouped).map(([category, skills]) => ({
    category: category as SkillCategory,
    skills,
  }));
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Add a skill to a person
 */
export async function addSkill(
  churchId: string,
  data: SkillCreateInput
): Promise<SkillInventory> {
  const values: NewSkillInventory = {
    churchId,
    personId: data.personId,
    skillCategory: data.skillCategory,
    skillName: data.skillName,
    proficiency: data.proficiency,
    notes: data.notes,
  };

  const [skill] = await db.insert(skillsInventory).values(values).returning();

  return skill;
}

/**
 * Update an existing skill
 */
export async function updateSkill(
  churchId: string,
  skillId: string,
  data: SkillUpdateInput
): Promise<SkillInventory> {
  const existing = await getSkill(churchId, skillId);

  if (!existing) {
    throw new Error("Skill not found");
  }

  const updateData: Partial<NewSkillInventory> = {};

  if (data.skillCategory !== undefined)
    updateData.skillCategory = data.skillCategory;
  if (data.skillName !== undefined) updateData.skillName = data.skillName;
  if (data.proficiency !== undefined) updateData.proficiency = data.proficiency;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const [updated] = await db
    .update(skillsInventory)
    .set(updateData)
    .where(
      and(
        eq(skillsInventory.churchId, churchId),
        eq(skillsInventory.id, skillId)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update skill");
  }

  return updated;
}

/**
 * Remove a skill from a person
 */
export async function removeSkill(
  churchId: string,
  skillId: string
): Promise<void> {
  const existing = await getSkill(churchId, skillId);

  if (!existing) {
    throw new Error("Skill not found");
  }

  await db
    .delete(skillsInventory)
    .where(
      and(
        eq(skillsInventory.churchId, churchId),
        eq(skillsInventory.id, skillId)
      )
    );
}
