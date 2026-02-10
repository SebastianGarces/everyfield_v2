// ============================================================================
// Template Service
// ============================================================================
//
// CRUD for message templates with copy-on-write semantics:
// - System templates (is_system=true, church_id=null) are immutable
// - When a church edits a system template, we fork it (copy-on-write)
// - The fork has source_template_id pointing to the original
// - getTemplates() returns church forks in place of their system originals
// ============================================================================

import { and, eq, isNull, or, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  messageTemplates,
  type MessageTemplate,
  type TemplateCategory,
} from "@/db/schema/communication";
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateFilters,
} from "@/lib/validations/communication";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * List templates visible to a church.
 * Returns system templates + church-specific templates.
 * If the church has a fork of a system template, the fork replaces the original.
 */
export async function getTemplates(
  churchId: string,
  filters?: TemplateFilters
): Promise<MessageTemplate[]> {
  const conditions = [
    or(eq(messageTemplates.isSystem, true), eq(messageTemplates.churchId, churchId)),
  ];

  if (filters?.category) {
    conditions.push(eq(messageTemplates.category, filters.category));
  }
  if (filters?.channel) {
    conditions.push(eq(messageTemplates.channel, filters.channel));
  }

  const allTemplates = await db
    .select()
    .from(messageTemplates)
    .where(and(...conditions))
    .orderBy(messageTemplates.category, messageTemplates.name);

  // De-duplicate: if a church fork exists for a system template, hide the original
  const forkedSystemIds = new Set(
    allTemplates
      .filter((t) => t.sourceTemplateId && t.churchId === churchId)
      .map((t) => t.sourceTemplateId!)
  );

  return allTemplates.filter((t) => !forkedSystemIds.has(t.id));
}

/**
 * Get a single template by ID.
 */
export async function getTemplate(
  id: string
): Promise<MessageTemplate | undefined> {
  const [template] = await db
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.id, id))
    .limit(1);
  return template;
}

/**
 * Get system templates only (for seeding / admin).
 */
export async function getSystemTemplates(): Promise<MessageTemplate[]> {
  return db
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.isSystem, true))
    .orderBy(messageTemplates.category, messageTemplates.name);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Create a brand-new church-specific template.
 */
export async function createTemplate(
  churchId: string,
  input: CreateTemplateInput
): Promise<MessageTemplate> {
  const [template] = await db
    .insert(messageTemplates)
    .values({
      churchId,
      name: input.name,
      description: input.description,
      category: input.category,
      channel: input.channel,
      subject: input.subject,
      body: input.body,
      isSystem: false,
    })
    .returning();
  return template;
}

/**
 * Fork a system template into a church-specific copy (copy-on-write).
 */
export async function forkTemplate(
  systemTemplateId: string,
  churchId: string
): Promise<MessageTemplate> {
  const source = await getTemplate(systemTemplateId);
  if (!source) throw new Error("Source template not found");
  if (!source.isSystem) throw new Error("Can only fork system templates");

  // Check if fork already exists
  const [existing] = await db
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.sourceTemplateId, systemTemplateId),
        eq(messageTemplates.churchId, churchId)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [fork] = await db
    .insert(messageTemplates)
    .values({
      churchId,
      name: source.name,
      description: source.description,
      category: source.category as TemplateCategory,
      channel: source.channel,
      subject: source.subject,
      body: source.body,
      bodyHtml: source.bodyHtml,
      mergeFields: source.mergeFields,
      isSystem: false,
      sourceTemplateId: systemTemplateId,
    })
    .returning();
  return fork;
}

/**
 * Update a template. If it's a system template, fork first.
 * Returns the updated (or newly forked) template.
 */
export async function updateTemplate(
  id: string,
  churchId: string,
  input: UpdateTemplateInput
): Promise<MessageTemplate> {
  const existing = await getTemplate(id);
  if (!existing) throw new Error("Template not found");

  // Copy-on-write: fork system templates before editing
  if (existing.isSystem) {
    const fork = await forkTemplate(id, churchId);
    // Apply the edits to the fork
    const [updated] = await db
      .update(messageTemplates)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(messageTemplates.id, fork.id))
      .returning();
    return updated;
  }

  // Regular update for church-owned templates
  if (existing.churchId !== churchId) {
    throw new Error("Cannot edit another church's template");
  }

  const [updated] = await db
    .update(messageTemplates)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(messageTemplates.id, id))
    .returning();
  return updated;
}

/**
 * Delete a church-specific template.
 * If it's a fork, the system original becomes visible again.
 * System templates cannot be deleted.
 */
export async function deleteTemplate(
  id: string,
  churchId: string
): Promise<void> {
  const existing = await getTemplate(id);
  if (!existing) throw new Error("Template not found");
  if (existing.isSystem) throw new Error("Cannot delete system templates");
  if (existing.churchId !== churchId) {
    throw new Error("Cannot delete another church's template");
  }

  await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
}
