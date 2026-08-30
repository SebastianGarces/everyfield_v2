import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { MAX_COMMITMENT_FILE_SIZE } from "@/lib/people/commitment-document";
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
import {
  EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES,
  EVRY_PEOPLE_ATTACHMENT_MAX_CHUNKS,
} from "./attachment-contract";

export const EVRY_PEOPLE_CSV_MAX_BYTES = 1024 * 1024;
export const EVRY_PEOPLE_IMPORT_MAX_ROWS = 25;
const CSV_TYPES = new Set(["text/csv", "application/vnd.ms-excel"]);
export const EVRY_PEOPLE_ATTACHMENT_MAX_AGE_MS = 30 * 60_000;

const referenceMetadataShape = {
  kind: z.enum(["person_photo", "people_csv", "commitment_document"]),
  actorUserId: z.string().uuid(),
  plantId: z.string().uuid(),
  personId: z.string().uuid().nullable(),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  contentType: z.string().min(1).max(100),
  size: z.number().int().positive().max(MAX_COMMITMENT_FILE_SIZE),
  originalName: z.string().min(1).max(255),
  expiresAt: z.string().datetime(),
} as const;

const storedReferenceDocumentSchema = z.strictObject({
  version: z.literal(1),
  ...referenceMetadataShape,
  storageKey: z.string().min(1).max(500),
});

const inlineReferenceDocumentSchema = z.strictObject({
  version: z.literal(2),
  ...referenceMetadataShape,
  uploadId: z.string().uuid(),
  bytesBase64Url: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_COMMITMENT_FILE_SIZE * 4) / 3))
    .regex(/^[A-Za-z0-9_-]+$/),
});

const chunkedReferenceDocumentSchema = z.strictObject({
  version: z.literal(3),
  ...referenceMetadataShape,
  uploadId: z.string().uuid(),
  chunkBytes: z.literal(EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES),
  chunkCount: z.number().int().min(1).max(EVRY_PEOPLE_ATTACHMENT_MAX_CHUNKS),
});

const referenceDocumentSchema = z.discriminatedUnion("version", [
  storedReferenceDocumentSchema,
  inlineReferenceDocumentSchema,
  chunkedReferenceDocumentSchema,
]);

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
  const parsed = referenceDocumentSchema.parse(document);
  if (parsed.version === 2) {
    const { bytesBase64Url, ...metadata } = parsed;
    const metadataPayload = Buffer.from(JSON.stringify(metadata)).toString(
      "base64url"
    );
    const payload = `v2.${metadataPayload}.${bytesBase64Url}`;
    return `${payload}.${signature(payload, secret).toString("base64url")}`;
  }
  const payload = Buffer.from(JSON.stringify(parsed)).toString("base64url");
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
  if (input.reference.startsWith("v2.")) {
    const [version, metadataPayload, bytesBase64Url, suppliedValue, extra] =
      input.reference.split(".");
    if (
      version !== "v2" ||
      !metadataPayload ||
      !bytesBase64Url ||
      !suppliedValue ||
      extra
    )
      return null;
    let supplied: Buffer;
    try {
      supplied = Buffer.from(suppliedValue, "base64url");
    } catch {
      return null;
    }
    const signedPayload = `v2.${metadataPayload}.${bytesBase64Url}`;
    const expected = signature(
      signedPayload,
      input.secret ?? secretFromEnvironment()
    );
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return null;
    let raw: unknown;
    try {
      raw = {
        ...JSON.parse(
          Buffer.from(metadataPayload, "base64url").toString("utf8")
        ),
        bytesBase64Url,
      };
    } catch {
      return null;
    }
    const parsed = inlineReferenceDocumentSchema.safeParse(raw);
    if (!parsed.success) return null;
    const value = parsed.data;
    if (
      value.actorUserId !== input.actor.userId ||
      value.plantId !== input.actor.plantId ||
      value.kind !== input.expectedKind
    )
      return null;
    return value;
  }
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
  const parsed = z
    .union([storedReferenceDocumentSchema, chunkedReferenceDocumentSchema])
    .safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  const prefix = `evry-inputs/${input.actor.plantId}/${input.actor.userId}/`;
  if (
    value.kind !== input.expectedKind ||
    value.actorUserId !== input.actor.userId ||
    value.plantId !== input.actor.plantId ||
    (value.version === 1 && !value.storageKey.startsWith(prefix))
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

export function evryPeopleStagedAttachmentChunkStorageKey(input: {
  actor: Scope;
  expiresAt: Date;
  uploadId: string;
  digest: string;
  chunkIndex: number;
  chunkCount: number;
}): string {
  const uploadId = z.string().uuid().parse(input.uploadId);
  const chunkIndex = z.number().int().min(0).parse(input.chunkIndex);
  const chunkCount = z
    .number()
    .int()
    .min(1)
    .max(EVRY_PEOPLE_ATTACHMENT_MAX_CHUNKS)
    .parse(input.chunkCount);
  if (chunkIndex >= chunkCount) throw new Error("Invalid attachment chunk");
  return `${stagedAttachmentPrefix(input.actor)}${input.expiresAt.getTime()}-${uploadId}-${input.digest}-${chunkIndex}-of-${chunkCount}.part`;
}

function chunkStorageKey(
  document: z.infer<typeof chunkedReferenceDocumentSchema>,
  chunkIndex: number
): string {
  return evryPeopleStagedAttachmentChunkStorageKey({
    actor: { userId: document.actorUserId, plantId: document.plantId },
    expiresAt: new Date(document.expiresAt),
    uploadId: document.uploadId,
    digest: document.digest,
    chunkIndex,
    chunkCount: document.chunkCount,
  });
}

/** Idempotently remove one exact actor/plant-scoped attachment reference. */
export async function removeEvryPeopleAttachment(input: {
  reference: string;
  actor: Scope;
  expectedKind: EvryPeopleAttachmentReference["kind"];
  secret?: string;
  remove?: EvryPeopleFileStorage["remove"];
}): Promise<boolean> {
  const document = openScopedEvryPeopleAttachmentReference(input);
  if (!document) return false;
  if (document.version === 1) {
    await (input.remove ?? evryPeopleFileStorage().remove)(document.storageKey);
  } else if (document.version === 3) {
    await Promise.all(
      Array.from({ length: document.chunkCount }, (_, chunkIndex) =>
        (input.remove ?? evryPeopleFileStorage().remove)(
          chunkStorageKey(document, chunkIndex)
        )
      )
    );
  }
  return true;
}

/**
 * Sweep expired staged inputs by the expiry embedded in their first-party key.
 * Deletion is idempotent, so an interrupted sweep converges.
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
    if (!key.startsWith(prefix)) continue;
    const relative = key.slice(prefix.length);
    const tail = input.actor
      ? relative
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(.+)$/i.exec(
          relative
        )?.[1];
    if (!tail) continue;
    const expiry =
      /^(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{64}(?:-\d+-of-\d+)?\.[a-z0-9]+$/i.exec(
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

type PrepareInput = Readonly<{
  actor: Scope;
  kind: EvryPeopleAttachmentReference["kind"];
  personId: string | null;
  name: string;
  type: string;
  size: number;
  digest: string;
  now?: Date;
  secret?: string;
  uploadId?: string;
  loadPerson?: typeof getPerson;
}>;

/** Authorize one compact, actor-scoped upload manifest without storing bytes. */
export async function prepareEvryPeopleAttachmentUpload(input: PrepareInput) {
  const now = input.now ?? new Date();
  if (
    !input.name ||
    input.name.length > 255 ||
    input.size <= 0 ||
    !/^[0-9a-f]{64}$/.test(input.digest)
  )
    return null;
  if (input.kind === "person_photo" || input.kind === "commitment_document") {
    if (
      !input.personId ||
      (input.kind === "person_photo"
        ? profilePhotoRefusal({ type: input.type, size: input.size })
        : !isAllowedCommitmentFileType(input.type) ||
          !isValidCommitmentFileSize(input.size))
    )
      return null;
    const person = await (input.loadPerson ?? getPerson)(
      input.actor.plantId,
      input.personId
    );
    if (!person) return null;
  } else if (
    input.personId !== null ||
    !CSV_TYPES.has(input.type) ||
    input.size > EVRY_PEOPLE_CSV_MAX_BYTES
  ) {
    return null;
  }
  const chunkCount = Math.ceil(input.size / EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES);
  const document = referenceDocumentSchema.parse({
    version: 3,
    kind: input.kind,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    personId: input.personId,
    digest: input.digest,
    contentType: input.type,
    size: input.size,
    originalName: input.name,
    expiresAt: new Date(
      now.getTime() + EVRY_PEOPLE_ATTACHMENT_MAX_AGE_MS
    ).toISOString(),
    uploadId: input.uploadId ?? randomUUID(),
    chunkBytes: EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES,
    chunkCount,
  });
  if (document.version !== 3) throw new Error("Invalid attachment manifest");
  return {
    reference: sealEvryPeopleAttachmentReference(document, input.secret),
    chunkBytes: document.chunkBytes,
    chunkCount: document.chunkCount,
  };
}

/** Store one bounded temporary chunk after reopening its exact signed manifest. */
export async function storeEvryPeopleAttachmentChunk(input: {
  actor: Scope;
  kind: EvryPeopleAttachmentReference["kind"];
  reference: string;
  chunkIndex: number;
  bytes: Buffer;
  now?: Date;
  secret?: string;
  create?: EvryPeopleFileStorage["create"];
  read?: EvryPeopleFileStorage["read"];
}): Promise<boolean> {
  const document = openEvryPeopleAttachmentReference({
    reference: input.reference,
    actor: input.actor,
    expectedKind: input.kind,
    now: input.now,
    secret: input.secret,
  });
  if (document?.version !== 3) return false;
  const expectedBytes =
    input.chunkIndex < document.chunkCount - 1
      ? document.chunkBytes
      : document.size - document.chunkBytes * (document.chunkCount - 1);
  if (
    input.chunkIndex < 0 ||
    input.chunkIndex >= document.chunkCount ||
    input.bytes.byteLength !== expectedBytes
  )
    return false;
  const key = chunkStorageKey(document, input.chunkIndex);
  const storage = evryPeopleFileStorage();
  const created = await (input.create ?? storage.create)(
    key,
    input.bytes,
    "application/octet-stream"
  );
  if (created === "created") return true;
  const existing = await (input.read ?? storage.read)(key);
  const existingBytes = existing ? Buffer.from(existing.body) : null;
  return Boolean(
    existingBytes &&
    existing?.contentType === "application/octet-stream" &&
    existingBytes.byteLength === input.bytes.byteLength &&
    timingSafeEqual(existingBytes, input.bytes)
  );
}

async function previewForAttachment(input: {
  kind: EvryPeopleAttachmentReference["kind"];
  bytes: Buffer;
  plantId: string;
  parseImport?: typeof parseCsvImport;
}) {
  const preview =
    input.kind === "people_csv"
      ? await (input.parseImport ?? parseCsvImport)(
          input.bytes.toString("utf8"),
          input.plantId
        )
      : null;
  return preview &&
    (preview.totalRows === 0 || preview.totalRows > EVRY_PEOPLE_IMPORT_MAX_ROWS)
    ? null
    : preview;
}

/** Verify every staged byte before returning the compact preview contract. */
export async function finalizeEvryPeopleAttachmentUpload(input: {
  actor: Scope;
  kind: EvryPeopleAttachmentReference["kind"];
  reference: string;
  now?: Date;
  secret?: string;
  read?: EvryPeopleFileStorage["read"];
  parseImport?: typeof parseCsvImport;
}) {
  const opened = openEvryPeopleAttachmentReference({
    reference: input.reference,
    actor: input.actor,
    expectedKind: input.kind,
    now: input.now,
    secret: input.secret,
  });
  if (opened?.version !== 3) return null;
  const exact = await readExactEvryPeopleAttachment({
    reference: input.reference,
    actor: input.actor,
    expectedKind: input.kind,
    expectedDigest: opened.digest,
    now: input.now,
    secret: input.secret,
    read: input.read,
  });
  if (!exact) return null;
  const preview = await previewForAttachment({
    kind: input.kind,
    bytes: exact.bytes,
    plantId: input.actor.plantId,
    parseImport: input.parseImport,
  });
  if (input.kind === "people_csv" && !preview) return null;
  return {
    reference: input.reference,
    metadata: {
      digest: opened.digest,
      contentType: opened.contentType,
      size: opened.size,
      originalName: opened.originalName,
    },
    preview,
  };
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
  create?: EvryPeopleFileStorage["create"];
  read?: EvryPeopleFileStorage["read"];
  sweep?: typeof sweepExpiredEvryPeopleAttachments;
}) {
  const now = input.now ?? new Date();
  if (!input.file.name || input.file.name.length > 255 || input.file.size <= 0)
    return null;
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (bytes.length !== input.file.size) return null;
  const digest = createHash("sha256").update(bytes).digest("hex");
  const prepared = await prepareEvryPeopleAttachmentUpload({
    actor: input.actor,
    kind: input.kind,
    personId: input.personId,
    name: input.file.name,
    type: input.file.type,
    size: input.file.size,
    digest,
    now,
    secret: input.secret,
    loadPerson: input.loadPerson,
  });
  if (!prepared) return null;
  for (let chunkIndex = 0; chunkIndex < prepared.chunkCount; chunkIndex += 1) {
    const start = chunkIndex * prepared.chunkBytes;
    const stored = await storeEvryPeopleAttachmentChunk({
      actor: input.actor,
      kind: input.kind,
      reference: prepared.reference,
      chunkIndex,
      bytes: bytes.subarray(start, start + prepared.chunkBytes),
      now,
      secret: input.secret,
      create: input.create,
      read: input.read,
    });
    if (!stored) return null;
  }
  return finalizeEvryPeopleAttachmentUpload({
    actor: input.actor,
    kind: input.kind,
    reference: prepared.reference,
    now,
    secret: input.secret,
    parseImport: input.parseImport,
    read: input.read,
  });
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
  if (document.version === 2) {
    const bytes = Buffer.from(document.bytesBase64Url, "base64url");
    if (
      bytes.toString("base64url") !== document.bytesBase64Url ||
      bytes.byteLength !== document.size ||
      createHash("sha256").update(bytes).digest("hex") !== document.digest
    )
      return null;
    return { document, bytes };
  }
  if (document.version === 3) {
    const chunks: Buffer[] = [];
    for (
      let chunkIndex = 0;
      chunkIndex < document.chunkCount;
      chunkIndex += 1
    ) {
      const stored = await (input.read ?? evryPeopleFileStorage().read)(
        chunkStorageKey(document, chunkIndex)
      );
      const expectedBytes =
        chunkIndex < document.chunkCount - 1
          ? document.chunkBytes
          : document.size - document.chunkBytes * (document.chunkCount - 1);
      if (
        !stored ||
        stored.contentType !== "application/octet-stream" ||
        stored.body.byteLength !== expectedBytes
      )
        return null;
      chunks.push(Buffer.from(stored.body));
    }
    const bytes = Buffer.concat(chunks);
    if (
      bytes.byteLength !== document.size ||
      createHash("sha256").update(bytes).digest("hex") !== document.digest
    )
      return null;
    return { document, bytes };
  }
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
