import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { parseCsvImport } from "@/lib/people/import";
import { getPerson } from "@/lib/people/service";
import {
  PROFILE_PHOTO_MAX_BYTES,
  profilePhotoRefusal,
} from "@/lib/profile-photo";
import {
  getFileBytes,
  isAllowedCommitmentFileType,
  isValidCommitmentFileSize,
  uploadFile,
} from "@/lib/storage";

export const EVRY_PEOPLE_CSV_MAX_BYTES = 1024 * 1024;
export const EVRY_PEOPLE_IMPORT_MAX_ROWS = 25;
const CSV_TYPES = new Set(["text/csv", "application/vnd.ms-excel"]);
const MAX_AGE_MS = 30 * 60_000;

const referenceDocumentSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(["person_photo", "people_csv", "commitment_document"]),
  actorUserId: z.string().uuid(),
  plantId: z.string().uuid(),
  personId: z.string().uuid().nullable(),
  storageKey: z.string().min(1).max(500),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  contentType: z.string().min(1).max(100),
  size: z.number().int().positive(),
  originalName: z.string().min(1).max(255),
  expiresAt: z.string().datetime(),
});

export type EvryPeopleAttachmentReference = z.infer<
  typeof referenceDocumentSchema
>;

export type EvryPeopleAttachmentFile = Readonly<{
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

type Scope = Pick<EvryPlantActor, "userId" | "plantId">;

function secretFromEnvironment(): string {
  const value = process.env.AWS_SECRET_ACCESS_KEY;
  if (!value) throw new Error("Attachment signing is unavailable");
  return value;
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function sealEvryPeopleAttachmentReference(
  document: EvryPeopleAttachmentReference,
  secret: string = secretFromEnvironment()
): string {
  const payload = Buffer.from(
    JSON.stringify(referenceDocumentSchema.parse(document))
  ).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function openEvryPeopleAttachmentReference(input: {
  reference: string;
  actor: Scope;
  expectedKind: EvryPeopleAttachmentReference["kind"];
  now?: Date;
  secret?: string;
}): EvryPeopleAttachmentReference | null {
  const [payload, suppliedValue, extra] = input.reference.split(".");
  if (!payload || !suppliedValue || extra) return null;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedValue, "base64url");
  } catch {
    return null;
  }
  const expected = signature(payload, input.secret ?? secretFromEnvironment());
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = referenceDocumentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  const prefix = `evry-inputs/${input.actor.plantId}/${input.actor.userId}/`;
  if (
    value.kind !== input.expectedKind ||
    value.actorUserId !== input.actor.userId ||
    value.plantId !== input.actor.plantId ||
    !value.storageKey.startsWith(prefix) ||
    new Date(value.expiresAt) <= (input.now ?? new Date())
  )
    return null;
  return value;
}

export async function stageEvryPeopleAttachment(input: {
  actor: Scope;
  kind: EvryPeopleAttachmentReference["kind"];
  personId: string | null;
  file: EvryPeopleAttachmentFile;
  now?: Date;
  secret?: string;
  loadPerson?: typeof getPerson;
  parseImport?: typeof parseCsvImport;
  store?: typeof uploadFile;
}) {
  const now = input.now ?? new Date();
  if (!input.file.name || input.file.name.length > 255 || input.file.size <= 0)
    return null;
  if (input.kind === "person_photo" || input.kind === "commitment_document") {
    if (
      !input.personId ||
      (input.kind === "person_photo"
        ? profilePhotoRefusal(input.file)
        : !isAllowedCommitmentFileType(input.file.type) ||
          !isValidCommitmentFileSize(input.file.size))
    )
      return null;
    const person = await (input.loadPerson ?? getPerson)(
      input.actor.plantId,
      input.personId
    );
    if (!person) return null;
  } else if (
    input.personId !== null ||
    !CSV_TYPES.has(input.file.type) ||
    input.file.size > EVRY_PEOPLE_CSV_MAX_BYTES
  ) {
    return null;
  }
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (bytes.length !== input.file.size) return null;
  const digest = createHash("sha256").update(bytes).digest("hex");
  const preview =
    input.kind === "people_csv"
      ? await (input.parseImport ?? parseCsvImport)(
          bytes.toString("utf8"),
          input.actor.plantId
        )
      : null;
  if (
    preview &&
    (preview.totalRows === 0 || preview.totalRows > EVRY_PEOPLE_IMPORT_MAX_ROWS)
  )
    return null;
  const extension =
    input.kind === "people_csv"
      ? "csv"
      : input.file.type === "application/pdf"
        ? "pdf"
        : input.file.type === "image/png"
          ? "png"
          : input.file.type === "image/webp"
            ? "webp"
            : "jpg";
  const storageKey = `evry-inputs/${input.actor.plantId}/${input.actor.userId}/${digest}.${extension}`;
  await (input.store ?? uploadFile)(storageKey, bytes, input.file.type);
  const document = referenceDocumentSchema.parse({
    version: 1,
    kind: input.kind,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    personId: input.personId,
    storageKey,
    digest,
    contentType: input.file.type,
    size: bytes.length,
    originalName: input.file.name,
    expiresAt: new Date(now.getTime() + MAX_AGE_MS).toISOString(),
  });
  return {
    reference: sealEvryPeopleAttachmentReference(document, input.secret),
    metadata: {
      digest: document.digest,
      contentType: document.contentType,
      size: document.size,
      originalName: document.originalName,
    },
    preview,
  };
}

export async function readExactEvryPeopleAttachment(input: {
  reference: string;
  actor: Scope;
  expectedKind: EvryPeopleAttachmentReference["kind"];
  expectedDigest: string;
  now?: Date;
  secret?: string;
  read?: typeof getFileBytes;
}) {
  const document = openEvryPeopleAttachmentReference(input);
  if (!document || document.digest !== input.expectedDigest) return null;
  const stored = await (input.read ?? getFileBytes)(document.storageKey);
  if (
    !stored ||
    stored.contentType !== document.contentType ||
    stored.body.byteLength !== document.size ||
    createHash("sha256").update(stored.body).digest("hex") !== document.digest
  )
    return null;
  return { document, bytes: Buffer.from(stored.body) };
}
