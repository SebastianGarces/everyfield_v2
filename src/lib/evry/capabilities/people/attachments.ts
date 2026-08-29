import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { parseCsvImport } from "@/lib/people/import";
import { getPerson } from "@/lib/people/service";
import { profilePhotoRefusal } from "@/lib/profile-photo";
import {
  isAllowedCommitmentFileType,
  isValidCommitmentFileSize,
} from "@/lib/storage";

import {
  evryPeopleFileStorage,
  type EvryPeopleFileStorage,
} from "./file-storage";

export const EVRY_PEOPLE_CSV_MAX_BYTES = 1024 * 1024;
export const EVRY_PEOPLE_IMPORT_MAX_ROWS = 25;
const CSV_TYPES = new Set(["text/csv", "application/vnd.ms-excel"]);
export const EVRY_PEOPLE_ATTACHMENT_MAX_AGE_MS = 30 * 60_000;

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
  return evryPeopleFileStorage().signingSecret();
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
  const value = openScopedEvryPeopleAttachmentReference(input);
  return value && new Date(value.expiresAt) > (input.now ?? new Date())
    ? value
    : null;
}

function openScopedEvryPeopleAttachmentReference(input: {
  reference: string;
  actor: Scope;
  expectedKind: EvryPeopleAttachmentReference["kind"];
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
    !value.storageKey.startsWith(prefix)
  )
    return null;
  return value;
}

function stagedAttachmentPrefix(actor?: Scope): string {
  return actor
    ? `evry-inputs/${actor.plantId}/${actor.userId}/`
    : "evry-inputs/";
}

export function evryPeopleStagedAttachmentStorageKey(input: {
  actor: Scope;
  expiresAt: Date;
  uploadId: string;
  digest: string;
  extension: string;
}): string {
  const uploadId = z.string().uuid().parse(input.uploadId);
  return `${stagedAttachmentPrefix(input.actor)}${input.expiresAt.getTime()}-${uploadId}-${input.digest}.${input.extension}`;
}

/** Idempotently remove one exact actor/plant-scoped staged attachment. */
export async function removeEvryPeopleAttachment(input: {
  reference: string;
  actor: Scope;
  expectedKind: EvryPeopleAttachmentReference["kind"];
  secret?: string;
  remove?: EvryPeopleFileStorage["remove"];
}): Promise<boolean> {
  const document = openScopedEvryPeopleAttachmentReference(input);
  if (!document) return false;
  await (input.remove ?? evryPeopleFileStorage().remove)(document.storageKey);
  return true;
}

/**
 * Sweep expired, unclaimed staged inputs by the expiry embedded in their
 * first-party key. Deletion is idempotent, so an interrupted sweep converges.
 */
export async function sweepExpiredEvryPeopleAttachments(
  input: {
    actor?: Scope;
    now?: Date;
    list?: EvryPeopleFileStorage["listKeys"];
    remove?: EvryPeopleFileStorage["remove"];
  } = {}
): Promise<Readonly<{ removed: number; failed: number }>> {
  const prefix = stagedAttachmentPrefix(input.actor);
  const keys = await (input.list ?? evryPeopleFileStorage().listKeys)(prefix);
  const now = (input.now ?? new Date()).getTime();
  let removed = 0;
  let failed = 0;
  for (const key of keys) {
    const tail = key.slice(prefix.length);
    const expiry =
      /^(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{64}\.[a-z0-9]+$/i.exec(
        tail
      )?.[1];
    if (!expiry || Number(expiry) > now) continue;
    try {
      await (input.remove ?? evryPeopleFileStorage().remove)(key);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
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
  store?: EvryPeopleFileStorage["store"];
  sweep?: typeof sweepExpiredEvryPeopleAttachments;
}) {
  const now = input.now ?? new Date();
  const sweep =
    input.sweep ?? (input.store ? null : sweepExpiredEvryPeopleAttachments);
  if (sweep) {
    try {
      await sweep({ actor: input.actor, now });
    } catch (error) {
      console.error("[evry:people] staged attachment sweep failed", error);
    }
  }
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
  const expiresAt = new Date(now.getTime() + EVRY_PEOPLE_ATTACHMENT_MAX_AGE_MS);
  const storageKey = evryPeopleStagedAttachmentStorageKey({
    actor: input.actor,
    expiresAt,
    uploadId: randomUUID(),
    digest,
    extension,
  });
  await (input.store ?? evryPeopleFileStorage().store)(
    storageKey,
    bytes,
    input.file.type
  );
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
    expiresAt: expiresAt.toISOString(),
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
  read?: EvryPeopleFileStorage["read"];
}) {
  const document = openEvryPeopleAttachmentReference(input);
  if (!document || document.digest !== input.expectedDigest) return null;
  const stored = await (input.read ?? evryPeopleFileStorage().read)(
    document.storageKey
  );
  if (
    !stored ||
    stored.contentType !== document.contentType ||
    stored.body.byteLength !== document.size ||
    createHash("sha256").update(stored.body).digest("hex") !== document.digest
  )
    return null;
  return { document, bytes: Buffer.from(stored.body) };
}
