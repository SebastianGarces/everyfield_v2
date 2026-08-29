import { NextResponse } from "next/server";
import { z } from "zod";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import { openEvryPeopleAttachmentReference } from "@/lib/evry/capabilities/people/attachments";
import {
  proposePeopleImport,
  proposePeoplePhotoUpload,
} from "@/lib/evry/capabilities/people/files";
import { proposeMilestoneEffect } from "@/lib/evry/capabilities/people/milestones";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
} from "@/lib/evry/eligibility/viewer";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;
const bodySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("person_photo"),
    reference: z.string().min(1).max(4_000),
  }),
  z.strictObject({
    kind: z.literal("commitment_document"),
    reference: z.string().min(1).max(4_000),
    commitmentType: z.enum(["core_group", "launch_team"]),
    signedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    witness: z.string().uuid().nullable(),
    notes: z.string().max(4_000).nullable(),
  }),
  z.strictObject({
    kind: z.literal("people_csv"),
    reference: z.string().min(1).max(4_000),
    duplicateResolutions: z.record(
      z.string().regex(/^\d+$/),
      z.enum(["skip", "create"])
    ),
  }),
]);

export async function POST(request: Request) {
  try {
    const actor = await requireEvryPlantViewer();
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { status: "invalid" },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success)
      return NextResponse.json(
        { status: "invalid" },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    const stableParts: [string, ...string[]] = [
      actor.userId,
      actor.plantId,
      parsed.data.reference,
      ...(parsed.data.kind === "person_photo"
        ? []
        : [JSON.stringify(parsed.data)]),
    ];
    let proposal;
    if (parsed.data.kind === "person_photo") {
      proposal = await proposePeoplePhotoUpload({
        actor,
        reference: parsed.data.reference,
        requestKey: deriveEvryPlanRequestKey(
          "people-photo-attachment",
          stableParts
        ),
      });
    } else if (parsed.data.kind === "people_csv") {
      proposal = await proposePeopleImport({
        actor,
        reference: parsed.data.reference,
        duplicateResolutions: parsed.data.duplicateResolutions,
        requestKey: deriveEvryPlanRequestKey(
          "people-csv-attachment",
          stableParts
        ),
      });
    } else {
      const opened = openEvryPeopleAttachmentReference({
        reference: parsed.data.reference,
        actor,
        expectedKind: "commitment_document",
      });
      proposal = opened?.personId
        ? await proposeMilestoneEffect({
            actor,
            pageContext: {
              kind: "person",
              recordId: opened.personId,
              label: "Person record",
            },
            selection: {
              kind: "commitment",
              values: {
                date: parsed.data.signedDate,
                type: parsed.data.commitmentType,
                ...(parsed.data.witness
                  ? { witness: parsed.data.witness }
                  : {}),
                ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
              },
            },
            attachmentReference: parsed.data.reference,
            requestKey: deriveEvryPlanRequestKey(
              "people-commitment-attachment",
              stableParts
            ),
          })
        : null;
    }
    return proposal
      ? NextResponse.json(
          { status: "review", ...proposal },
          { headers: PRIVATE_HEADERS }
        )
      : NextResponse.json(
          { status: "unavailable" },
          { status: 404, headers: PRIVATE_HEADERS }
        );
  } catch (error) {
    const refused =
      isUnauthorized(error) || error instanceof EvryPlantViewerRefusalError;
    return NextResponse.json(
      { status: refused ? "unavailable" : "failed" },
      { status: refused ? 404 : 500, headers: PRIVATE_HEADERS }
    );
  }
}
