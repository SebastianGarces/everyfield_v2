import { NextResponse } from "next/server";
import { z } from "zod";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import {
  proposeEvryPersonUpdate,
  readEvryPerson,
  type EvryPersonProposalResult,
  type EvryPersonReadResult,
} from "@/lib/evry/eligibility/repository";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
} from "@/lib/evry/eligibility/viewer";

export const dynamic = "force-dynamic";

const probeRequestSchema = z.object({
  operation: z.enum(["read", "propose-write"]),
  recordId: z.string().uuid(),
});

function statusFor(
  result: EvryPersonReadResult | EvryPersonProposalResult
): number {
  switch (result.status) {
    case "available":
      return 200;
    case "refused":
      return 403;
    case "unavailable":
      return 404;
  }
}

/**
 * A backend-only request proof for EV-002–EV-004.
 *
 * It has no product navigation or UI caller and performs no effect. The first
 * viewer check gates parsing; `authorizeEvryCapability` deliberately re-mints
 * the actor after parsing, immediately before the scoped read or proposal.
 */
export async function POST(request: Request) {
  try {
    await requireEvryPlantViewer();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ status: "invalid" }, { status: 400 });
    }

    const parsed = probeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ status: "invalid" }, { status: 400 });
    }

    const result =
      parsed.data.operation === "read"
        ? await readEvryPerson(parsed.data.recordId)
        : await proposeEvryPersonUpdate(parsed.data.recordId);

    return NextResponse.json(result, { status: statusFor(result) });
  } catch (error) {
    if (isUnauthorized(error)) {
      return NextResponse.json({ status: "unavailable" }, { status: 401 });
    }
    if (error instanceof EvryPlantViewerRefusalError) {
      return NextResponse.json({ status: "unavailable" }, { status: 404 });
    }
    throw error;
  }
}
