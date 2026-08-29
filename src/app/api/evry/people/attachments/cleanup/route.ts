import { NextResponse } from "next/server";

import { sweepExpiredEvryPeopleAttachments } from "@/lib/evry/capabilities/people/attachments";
import { sweepAllEvryCommitmentDocumentObjects } from "@/lib/people/evry-milestones";
import { sweepAllEvryPersonPhotoObjects } from "@/lib/people/person-photo";
import { matchesBearerSecret } from "@/lib/security/constant-time";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

export function createEvryPeopleAttachmentCleanupGet({
  sweepStaged = sweepExpiredEvryPeopleAttachments,
  sweepPhotos = sweepAllEvryPersonPhotoObjects,
  sweepCommitments = sweepAllEvryCommitmentDocumentObjects,
}: {
  sweepStaged?: typeof sweepExpiredEvryPeopleAttachments;
  sweepPhotos?: typeof sweepAllEvryPersonPhotoObjects;
  sweepCommitments?: typeof sweepAllEvryCommitmentDocumentObjects;
} = {}) {
  return async function evryPeopleAttachmentCleanupGet(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (
      !secret ||
      !matchesBearerSecret(request.headers.get("authorization"), secret)
    ) {
      return NextResponse.json(
        { status: "unauthorized" },
        { status: 401, headers: PRIVATE_HEADERS }
      );
    }
    try {
      const results = await Promise.all([
        sweepStaged(),
        sweepPhotos(),
        sweepCommitments(),
      ]);
      const result = results.reduce(
        (total, current) => ({
          removed: total.removed + current.removed,
          failed: total.failed + current.failed,
        }),
        { removed: 0, failed: 0 }
      );
      return NextResponse.json(
        { status: result.failed === 0 ? "completed" : "incomplete", ...result },
        {
          status: result.failed === 0 ? 200 : 503,
          headers: PRIVATE_HEADERS,
        }
      );
    } catch (error) {
      console.error("[evry:people] attachment cleanup failed", error);
      return NextResponse.json(
        { status: "unavailable" },
        { status: 503, headers: PRIVATE_HEADERS }
      );
    }
  };
}

export const GET = createEvryPeopleAttachmentCleanupGet();
