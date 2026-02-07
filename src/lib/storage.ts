import {
  DeleteObjectCommand,
  GetObjectCommand,
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
  };

  return mimeToExt[mimeType] || "bin";
}

/**
 * Validate that a file type is allowed for commitment documents.
 */
export function isAllowedCommitmentFileType(mimeType: string): boolean {
  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
  ];
  return allowedTypes.includes(mimeType);
}

/**
 * Maximum file size for commitment documents (10MB).
 */
export const MAX_COMMITMENT_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validate file size for commitment documents.
 */
export function isValidCommitmentFileSize(size: number): boolean {
  return size <= MAX_COMMITMENT_FILE_SIZE;
}
