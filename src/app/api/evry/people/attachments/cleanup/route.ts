import { NextResponse } from "next/server";

import { sweepExpiredEvryPeopleAttachments } from "@/lib/evry/capabilities/people/attachments";
import { matchesBearerSecret } from "@/lib/security/constant-time";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

export function createEvryPeopleAttachmentCleanupGet({
  sweep = sweepExpiredEvryPeopleAttachments,
}: {
  sweep?: typeof sweepExpiredEvryPeopleAttachments;
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
      const result = await sweep();
      return NextResponse.json(
        { status: result.failed === 0 ? "completed" : "incomplete", ...result },
        {
          status: result.failed === 0 ? 200 : 503,
          headers: PRIVATE_HEADERS,
        }
      );
    } catch (error) {
      console.error("[evry:people] staged attachment cleanup failed", error);
      return NextResponse.json(
        { status: "unavailable" },
        { status: 503, headers: PRIVATE_HEADERS }
      );
    }
  };
}

export const GET = createEvryPeopleAttachmentCleanupGet();
