// ============================================================================
// Generated document artifacts — persist, list, re-download (DOC-008)
// ============================================================================
//
// Templates stay code-defined. This module records what was produced: the
// rendered bytes go to the private Tigris bucket FIRST, then a history row
// is inserted. An insert failure deletes the object. Never insert a key that
// was not uploaded. `db.transaction()` throws on neon-http; this path is one
// external write plus one DB write, marker last.
//
// Isolation is application-layer. Every read, and the signed-URL lookup,
// scopes `eq(churchId, <session church>)`. The client names an artifact id,
// never a storage key; a foreign id reads as missing.
// ============================================================================

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  generatedDocuments,
  type GeneratedDocument,
  type NewGeneratedDocument,
} from "@/db/schema";
import { getTemplateById } from "@/lib/documents/templates";
import { FORMAT_OUTPUT, type DocumentFormat } from "@/lib/documents/types";
import { deleteFile, getSignedDownloadUrl, uploadFile } from "@/lib/storage";

/** Signed re-download URLs expire after one hour, same as commitment files. */
export const GENERATED_DOCUMENT_SIGNED_URL_EXPIRES_IN = 3600;

export type GeneratedDocumentListItem = {
  id: string;
  templateId: string;
  templateName: string;
  format: DocumentFormat;
  createdAt: Date;
};

export function generatedDocumentStorageKey(
  churchId: string,
  id: string,
  ext: string
): string {
  return `documents/${churchId}/${id}.${ext}`;
}

export function generatedDocumentRow(input: {
  id: string;
  churchId: string;
  userId: string;
  templateId: string;
  format: DocumentFormat;
}): NewGeneratedDocument {
  const ext = FORMAT_OUTPUT[input.format].ext;
  return {
    id: input.id,
    churchId: input.churchId,
    userId: input.userId,
    templateId: input.templateId,
    format: input.format,
    storageKey: generatedDocumentStorageKey(input.churchId, input.id, ext),
  };
}

export function toGeneratedDocumentListItem(
  row: GeneratedDocument
): GeneratedDocumentListItem {
  const template = getTemplateById(row.templateId);
  return {
    id: row.id,
    templateId: row.templateId,
    templateName: template?.name ?? row.templateId,
    format: row.format,
    createdAt: row.createdAt,
  };
}

/** Church-scoped history, newest first. */
export function generatedDocumentsForChurchQuery(churchId: string) {
  return db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.churchId, churchId))
    .orderBy(desc(generatedDocuments.createdAt));
}

/**
 * Lookup by id AND church. A foreign uuid — even one that exists — reads as
 * missing. This query is the signed-URL gate; never look up by id alone.
 */
export function generatedDocumentForChurchQuery(churchId: string, id: string) {
  return db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.id, id),
        eq(generatedDocuments.churchId, churchId)
      )
    )
    .limit(1);
}

export function insertGeneratedDocumentQuery(row: NewGeneratedDocument) {
  return db.insert(generatedDocuments).values(row).returning();
}

export async function listGeneratedDocuments(
  churchId: string
): Promise<GeneratedDocumentListItem[]> {
  const rows = await generatedDocumentsForChurchQuery(churchId);
  return rows.map(toGeneratedDocumentListItem);
}

export async function getGeneratedDocument(
  churchId: string,
  id: string
): Promise<GeneratedDocument | null> {
  const [row] = await generatedDocumentForChurchQuery(churchId, id);
  return row ?? null;
}

/**
 * Sign a download URL for an artifact this church owns. Returns null when the
 * id is missing or belongs to another tenant — never signs a guessed key.
 */
export async function getGeneratedDocumentDownloadUrl(
  churchId: string,
  id: string
): Promise<string | null> {
  const row = await getGeneratedDocument(churchId, id);
  if (!row) return null;

  const ext = FORMAT_OUTPUT[row.format].ext;
  const filename = `${row.templateId}.${ext}`;
  return getSignedDownloadUrl(
    row.storageKey,
    filename,
    GENERATED_DOCUMENT_SIGNED_URL_EXPIRES_IN
  );
}

export async function recordGeneratedDocument(input: {
  churchId: string;
  userId: string;
  templateId: string;
  format: DocumentFormat;
  bytes: Buffer;
}): Promise<GeneratedDocument> {
  const id = crypto.randomUUID();
  const row = generatedDocumentRow({
    id,
    churchId: input.churchId,
    userId: input.userId,
    templateId: input.templateId,
    format: input.format,
  });
  const { mime } = FORMAT_OUTPUT[input.format];

  await uploadFile(row.storageKey, input.bytes, mime);

  try {
    const [inserted] = await insertGeneratedDocumentQuery(row);
    if (!inserted) {
      throw new Error("Failed to record generated document");
    }
    return inserted;
  } catch (error) {
    try {
      await deleteFile(row.storageKey);
    } catch (cleanupError) {
      console.error(
        "[documents] failed to delete object after insert failure:",
        cleanupError
      );
    }
    throw error;
  }
}
