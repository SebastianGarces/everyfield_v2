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

import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  generatedDocuments,
  type GeneratedDocument,
  type NewGeneratedDocument,
} from "@/db/schema";
import { getTemplateById } from "@/lib/documents/templates";
import { FORMAT_OUTPUT, type DocumentFormat } from "@/lib/documents/types";
import { deleteFile, getSignedDownloadUrl, uploadFile } from "@/lib/storage";
import { evryDocumentStorage } from "@/lib/evry/capabilities/documents-wiki/document-storage";

/** Signed re-download URLs expire after one hour, same as commitment files. */
export const GENERATED_DOCUMENT_SIGNED_URL_EXPIRES_IN = 3600;

/**
 * The most recent artifacts the history page will read. Generation is
 * unthrottled, so an unbounded `SELECT *` here is a church-controlled payload
 * — the cap is what keeps one busy church from returning every row it ever
 * made. The `(church_id, created_at)` index serves the ordered slice.
 *
 * The cap is SILENT: the page shows the newest 100 and says nothing about
 * older ones. Retired by the first paging control on this surface.
 */
export const GENERATED_DOCUMENT_HISTORY_LIMIT = 100;
export const EVRY_GENERATED_DOCUMENT_PAGE_SIZE = 25;

export type GeneratedDocumentListItem = {
  id: string;
  templateId: string;
  templateName: string;
  format: DocumentFormat;
  filename: string;
  createdAt: Date;
};

export function generatedDocumentStorageKey(
  churchId: string,
  id: string,
  ext: string
): string {
  return `documents/${churchId}/${id}.${ext}`;
}

/** Download filename for a stored artifact — template id plus format extension. */
export function generatedDocumentFilename(
  templateId: string,
  format: DocumentFormat
): string {
  return `${templateId}.${FORMAT_OUTPUT[format].ext}`;
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
    filename: generatedDocumentFilename(row.templateId, row.format),
    createdAt: row.createdAt,
  };
}

/** Church-scoped history, newest first, capped at `GENERATED_DOCUMENT_HISTORY_LIMIT`. */
export function generatedDocumentsForChurchQuery(churchId: string) {
  return db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.churchId, churchId))
    .orderBy(desc(generatedDocuments.createdAt))
    .limit(GENERATED_DOCUMENT_HISTORY_LIMIT);
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

export function insertGeneratedDocumentIfAbsentQuery(
  row: NewGeneratedDocument
) {
  return db
    .insert(generatedDocuments)
    .values(row)
    .onConflictDoNothing()
    .returning();
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

type GeneratedDocumentCursor = Readonly<{
  createdAtExact: string;
  id: string;
}>;

export function encodeGeneratedDocumentCursor(
  row: GeneratedDocumentCursor
): string {
  return Buffer.from(
    JSON.stringify({ createdAtExact: row.createdAtExact, id: row.id }),
    "utf8"
  ).toString("base64url");
}

const generatedDocumentCursorTimestamp = z
  .string()
  .regex(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/)
  .refine((value) => {
    const match =
      /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(
        value
      );
    if (!match) return false;
    const [year, month, day, hour, minute, second] = match
      .slice(1, 7)
      .map(Number);
    if (
      !year ||
      month! < 1 ||
      month! > 12 ||
      hour! > 23 ||
      minute! > 59 ||
      second! > 59
    )
      return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day! >= 1 && day! <= days[month! - 1]!;
  });

const generatedDocumentCursorSchema = z.strictObject({
  createdAtExact: generatedDocumentCursorTimestamp,
  id: z.string().uuid(),
});

export function decodeGeneratedDocumentCursor(
  value: string | null
): GeneratedDocumentCursor | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as unknown;
    const cursor = generatedDocumentCursorSchema.safeParse(parsed);
    return cursor.success ? cursor.data : null;
  } catch {
    return null;
  }
}

export async function listGeneratedDocumentPage(
  churchId: string,
  cursorValue: string | null
) {
  const cursor = decodeGeneratedDocumentCursor(cursorValue);
  if (cursorValue !== null && !cursor) return null;
  const cursorPredicate = cursor
    ? sql`(${generatedDocuments.createdAt}, ${generatedDocuments.id}) < (${cursor.createdAtExact}::timestamp, ${cursor.id}::uuid)`
    : undefined;
  const rows = await db
    .select({
      ...getTableColumns(generatedDocuments),
      createdAtExact: sql<string>`${generatedDocuments.createdAt}::text`,
    })
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.churchId, churchId), cursorPredicate))
    .orderBy(desc(generatedDocuments.createdAt), desc(generatedDocuments.id))
    .limit(EVRY_GENERATED_DOCUMENT_PAGE_SIZE + 1);
  const page = rows.slice(0, EVRY_GENERATED_DOCUMENT_PAGE_SIZE);
  return {
    items: page.map(toGeneratedDocumentListItem),
    nextCursor:
      rows.length > EVRY_GENERATED_DOCUMENT_PAGE_SIZE && page.length > 0
        ? encodeGeneratedDocumentCursor(page[page.length - 1]!)
        : null,
  };
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

  return getSignedDownloadUrl(
    row.storageKey,
    generatedDocumentFilename(row.templateId, row.format),
    GENERATED_DOCUMENT_SIGNED_URL_EXPIRES_IN
  );
}

/**
 * The three effects `recordGeneratedDocument` sequences, injectable so the
 * crash-safety contract can be asserted by RUNNING the function against a
 * forced failure instead of by reading its source. Production never passes
 * this — the defaults below are the real bucket and the real table.
 */
export type GeneratedDocumentEffects = {
  upload: (key: string, bytes: Buffer, mime: string) => Promise<unknown>;
  insert: (row: NewGeneratedDocument) => Promise<GeneratedDocument | undefined>;
  remove: (key: string) => Promise<unknown>;
};

const LIVE_EFFECTS: GeneratedDocumentEffects = {
  upload: uploadFile,
  insert: async (row) => (await insertGeneratedDocumentQuery(row))[0],
  remove: deleteFile,
};

export async function recordGeneratedDocument(
  input: {
    churchId: string;
    userId: string;
    templateId: string;
    format: DocumentFormat;
    bytes: Buffer;
  },
  effects: GeneratedDocumentEffects = LIVE_EFFECTS
): Promise<GeneratedDocument> {
  const id = crypto.randomUUID();
  const row = generatedDocumentRow({
    id,
    churchId: input.churchId,
    userId: input.userId,
    templateId: input.templateId,
    format: input.format,
  });
  const { mime } = FORMAT_OUTPUT[input.format];

  // Upload FIRST and let a failure propagate untouched: the insert below is
  // never reached, so a key whose object does not exist is never recorded.
  await effects.upload(row.storageKey, input.bytes, mime);

  try {
    const inserted = await effects.insert(row);
    if (!inserted) {
      throw new Error("Failed to record generated document");
    }
    return inserted;
  } catch (error) {
    try {
      await effects.remove(row.storageKey);
    } catch (cleanupError) {
      console.error(
        "[documents] failed to delete object after insert failure:",
        cleanupError
      );
    }
    throw error;
  }
}

/**
 * Persist one Evry-generated artifact at an effect-key-derived id.
 *
 * The object key and row id are both deterministic. A crash after upload simply
 * uploads the same immutable bytes again, while a crash after insert observes
 * the exact row before doing any render or storage work. `ON CONFLICT DO
 * NOTHING` is the same-key concurrency fence; a conflict is accepted only when
 * the existing row has the exact expected owner/template/format/key tuple.
 */
export async function recordGeneratedDocumentAtId(input: {
  id: string;
  churchId: string;
  userId: string;
  templateId: string;
  format: DocumentFormat;
  bytes: Buffer;
}): Promise<GeneratedDocument> {
  const expected = generatedDocumentRow(input);
  const existing = await getGeneratedDocument(input.churchId, input.id);
  if (existing) {
    if (
      existing.userId !== expected.userId ||
      existing.templateId !== expected.templateId ||
      existing.format !== expected.format ||
      existing.storageKey !== expected.storageKey
    ) {
      throw new Error("Generated document effect identity mismatch");
    }
    return existing;
  }

  await evryDocumentStorage().store(
    expected.storageKey,
    input.bytes,
    FORMAT_OUTPUT[input.format].mime
  );
  const inserted = (await insertGeneratedDocumentIfAbsentQuery(expected))[0];
  if (inserted) return inserted;
  const winner = await getGeneratedDocument(input.churchId, input.id);
  if (
    !winner ||
    winner.userId !== expected.userId ||
    winner.templateId !== expected.templateId ||
    winner.format !== expected.format ||
    winner.storageKey !== expected.storageKey
  ) {
    throw new Error("Generated document effect did not converge");
  }
  return winner;
}
