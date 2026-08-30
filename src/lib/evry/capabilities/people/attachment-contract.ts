import { MAX_COMMITMENT_FILE_SIZE } from "@/lib/people/commitment-document";

/**
 * Legacy v2 plans may still contain an inline 10 MiB attachment. Keep their
 * persisted-plan validators readable while new network contracts accept only
 * the compact v3 manifest below.
 */
export const EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH =
  Math.ceil((MAX_COMMITMENT_FILE_SIZE * 4) / 3) + 8_192;

/** A v3 reference is signed metadata only; attachment bytes never ride in it. */
export const EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH = 4_096;

/**
 * Raw chunk size chosen so multipart framing remains comfortably below
 * Vercel's non-configurable 4.5 MiB request-body ceiling.
 */
export const EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES = 3 * 1024 * 1024;
export const EVRY_PEOPLE_ATTACHMENT_MAX_CHUNKS = Math.ceil(
  MAX_COMMITMENT_FILE_SIZE / EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES
);
export const EVRY_PEOPLE_ATTACHMENT_ROUTE_MAX_BYTES =
  EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES + 64 * 1024;
export const EVRY_PEOPLE_ATTACHMENT_PLATFORM_BODY_CAP_BYTES = 4.5 * 1024 * 1024;
