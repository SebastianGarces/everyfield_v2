import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ============================================================================
// Configuration
// ============================================================================

const BUCKET_NAME = process.env.AWS_BUCKET_NAME!;

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  endpoint: process.env.AWS_ENDPOINT_URL_S3!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// ============================================================================
// File Upload
// ============================================================================

/**
 * Upload a file to the private S3-compatible bucket.
 * @param key - The storage key (path) for the file
 * @param body - The file content as a Buffer
 * @param contentType - The MIME type of the file
 * @returns The storage key (not a URL, since bucket is private)
 */
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await s3Client.send(command);
  return key;
}

// ============================================================================
// File Deletion
// ============================================================================

/**
 * Delete a file from the bucket.
 * @param key - The storage key (path) of the file to delete
 */
export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}

export type StoredFileObject = Readonly<{
  key: string;
  lastModified: Date | null;
}>;

/** List every private object below one closed application prefix. */
export async function listFileObjects(
  prefix: string
): Promise<StoredFileObject[]> {
  const objects: StoredFileObject[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const object of result.Contents ?? [])
      if (object.Key)
        objects.push({
          key: object.Key,
          lastModified: object.LastModified ?? null,
        });
    continuationToken = result.IsTruncated
      ? result.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return objects;
}

/** List every private object key below one closed application prefix. */
export async function listFileKeys(prefix: string): Promise<string[]> {
  return (await listFileObjects(prefix)).map(({ key }) => key);
}

// ============================================================================
// Signed URLs for Download
// ============================================================================

/**
 * Generate a signed URL for downloading a file.
 * The URL includes Content-Disposition: attachment to trigger browser download.
 *
 * @param key - The storage key (path) of the file
 * @param filename - The filename to use in Content-Disposition header
 * @param expiresInSeconds - URL expiration time (default: 1 hour)
 * @returns A signed URL that triggers a browser download when accessed
 */
export async function getSignedDownloadUrl(
  key: string,
  filename: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  });

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  });

  return signedUrl;
}

// ============================================================================
// Reading Objects Back
// ============================================================================

/**
 * Read a stored object back as bytes.
 *
 * The bucket is private and stays private: nothing outside the server ever
 * holds a key or a signed URL for a person photo, so the only way to read one
 * is through a route handler that has already checked the session and the
 * church. That handler needs the bytes, not a URL — see
 * `src/app/api/people/[personId]/photo/route.ts`.
 *
 * Returns null when the object is gone, so a row pointing at a deleted object
 * reads as "no photo" instead of throwing the route's own failure.
 */
export async function getFileBytes(
  key: string
): Promise<{ body: Uint8Array; contentType: string } | null> {
  try {
    const result = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key })
    );
    if (!result.Body) return null;
    return {
      body: await result.Body.transformToByteArray(),
      contentType: result.ContentType ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get the file extension from a MIME type.
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  return mimeToExt[mimeType] || "bin";
}

// ============================================================================
// Person Photos (P-024a)
// ============================================================================

/**
 * The one spelling of a person photo's storage key.
 *
 * `{domain}/{churchId}/{personId}/{uuid}.{ext}` — the convention the
 * commitment documents already follow. The church id is IN the key so an
 * operator reading the bucket can tell whose object it is, but nothing outside
 * this server ever sees a key: the read path is a session-checked route
 * handler, not a URL handed to the browser.
 *
 * The uuid is fresh on every upload rather than derived from the person, which
 * is what makes a replacement a NEW object — the old one is deleted explicitly
 * after the row stops pointing at it, so a failed delete leaves collectable
 * garbage rather than a broken avatar.
 */
export function personPhotoStorageKey(
  churchId: string,
  personId: string,
  ext: string,
  objectId: string = crypto.randomUUID()
): string {
  return `people/${churchId}/${personId}/${objectId}.${ext}`;
}

// ============================================================================
// Account Pictures (CS-004, #617)
// ============================================================================

/**
 * The one spelling of an account picture's storage key.
 *
 * `avatars/{userId}/{uuid}.{ext}` — the same convention `personPhotoStorageKey`
 * follows, one segment shorter because an account belongs to no tenancy. An
 * account holds a seat in a church, a sending church or a network, or in none
 * at all (a coach), and it can be re-seated; a key with a tenancy in it would
 * either go stale on that move or make the picture something the tenancy owns.
 * It is the ACCOUNT'S picture, so the account id is the whole path.
 *
 * The uuid is fresh on every upload rather than derived from the account, for
 * the same two reasons the person key gives: a replacement is a NEW object, so
 * the old one is deleted explicitly after the row stops pointing at it and a
 * failed delete leaves collectable garbage; and the uuid is what the browser
 * sees change when the bytes do (`userAvatarSrc`).
 */
export function userAvatarStorageKey(userId: string, ext: string): string {
  return `avatars/${userId}/${crypto.randomUUID()}.${ext}`;
}

// What a photo MAY be lives in `@/lib/profile-photo` instead, and deliberately:
// the picker in the browser applies the same rule before it sends, and this
// module pulls in the AWS SDK, so it can never be imported there.

// ============================================================================
// Commitment Documents
// ============================================================================

export {
  isAllowedCommitmentFileType,
  isValidCommitmentFileSize,
  MAX_COMMITMENT_FILE_SIZE,
} from "@/lib/people/commitment-document";

export function commitmentDocumentStorageKey(
  churchId: string,
  personId: string,
  ext: string,
  objectId: string = crypto.randomUUID()
): string {
  return `commitments/${churchId}/${personId}/${objectId}.${ext}`;
}
