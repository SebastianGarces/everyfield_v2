import { MAX_COMMITMENT_FILE_SIZE } from "@/lib/people/commitment-document";

/**
 * A v2 reference carries one base64url-encoded attachment plus bounded signed
 * metadata. It is persisted with the pending plan, never in object storage.
 */
export const EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH =
  Math.ceil((MAX_COMMITMENT_FILE_SIZE * 4) / 3) + 8_192;
