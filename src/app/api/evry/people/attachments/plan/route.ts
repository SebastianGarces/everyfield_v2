import { NextResponse } from "next/server";
import { z } from "zod";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import { openEvryPeopleAttachmentReference } from "@/lib/evry/capabilities/people/attachments";
import {
  persistEvryPeopleFileReview,
  recoverEvryPeopleFileReview,
} from "@/lib/evry/capabilities/people/file-conversation";
import { readPeopleImportPreviewArtifact } from "@/lib/evry/capabilities/people/file-reads";
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
import {
  parseEvryConversationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";

import { publicEvryConversation } from "../../../conversations/shared";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;
export const EVRY_PEOPLE_PLAN_MAX_BYTES = 64 * 1024;
const bodySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("person_photo"),
    reference: z.string().min(1).max(4_000),
    conversationId: z.string().uuid().nullable(),
    requestKey: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal("commitment_document"),
    reference: z.string().min(1).max(4_000),
    commitmentType: z.enum(["core_group", "launch_team"]),
    signedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    witness: z.string().uuid().nullable(),
    notes: z.string().max(4_000).nullable(),
    conversationId: z.string().uuid().nullable(),
    requestKey: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal("people_csv"),
    reference: z.string().min(1).max(4_000),
    duplicateResolutions: z.record(
      z.string().regex(/^\d+$/),
      z.enum(["skip", "create", "merge"])
    ),
    conversationId: z.string().uuid().nullable(),
    requestKey: z.string().uuid(),
  }),
]);

export function createEvryPeopleAttachmentPlanPost({
  requireViewer = requireEvryPlantViewer,
}: {
  requireViewer?: typeof requireEvryPlantViewer;
} = {}) {
  return async function evryPeopleAttachmentPlanPost(request: Request) {
    try {
      const actor = await requireViewer();
      const contentLength = Number(request.headers.get("content-length"));
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength <= 0 ||
        contentLength > EVRY_PEOPLE_PLAN_MAX_BYTES
      ) {
        return NextResponse.json(
          { status: "invalid" },
          { status: 413, headers: PRIVATE_HEADERS }
        );
      }
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
      const labels = {
        person_photo: {
          user: "Attached a person photo for review.",
          assistant: "Review this exact photo change before anything is saved.",
        },
        commitment_document: {
          user: "Attached a commitment document for review.",
          assistant:
            "Review this exact commitment and attachment before anything is saved.",
        },
        people_csv: {
          user: "Attached a People CSV import for review.",
          assistant:
            "Review the interpreted CSV rows and exact import before anything is saved.",
        },
      } as const;
      const now = new Date();
      const recovered = await recoverEvryPeopleFileReview({
        actor,
        conversationId: parsed.data.conversationId,
        requestKey: parsed.data.requestKey,
        userMessage: labels[parsed.data.kind].user,
        now,
      });
      if (recovered) {
        return NextResponse.json(
          {
            status: parsed.data.conversationId ? "continued" : "created",
            conversation: publicEvryConversation(recovered),
          },
          {
            status: parsed.data.conversationId ? 200 : 201,
            headers: PRIVATE_HEADERS,
          }
        );
      }
      const stableParts: [string, ...string[]] = [
        actor.userId,
        actor.plantId,
        parsed.data.requestKey,
        ...(parsed.data.kind === "person_photo" ? [] : [parsed.data.kind]),
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
      if (!proposal)
        return NextResponse.json(
          { status: "unavailable" },
          { status: 404, headers: PRIVATE_HEADERS }
        );
      const preview =
        parsed.data.kind === "people_csv"
          ? await readPeopleImportPreviewArtifact({
              actor,
              attachmentReference: parsed.data.reference,
              attachmentDigest:
                openEvryPeopleAttachmentReference({
                  reference: parsed.data.reference,
                  actor,
                  expectedKind: "people_csv",
                })?.digest ?? "",
            })
          : null;
      const persisted = await persistEvryPeopleFileReview({
        actor,
        conversationId: parsed.data.conversationId,
        requestKey: parsed.data.requestKey,
        userMessage: labels[parsed.data.kind].user,
        assistantMessage: labels[parsed.data.kind].assistant,
        artifacts: [
          ...(preview ? [storedEvryReadArtifactDocument(preview)] : []),
          parseEvryConversationArtifactDocument(proposal.confirmation),
        ],
        plan: proposal.plan,
        now,
      });
      return persisted
        ? NextResponse.json(
            {
              status: parsed.data.conversationId ? "continued" : "created",
              conversation: publicEvryConversation(persisted),
            },
            {
              status: parsed.data.conversationId ? 200 : 201,
              headers: PRIVATE_HEADERS,
            }
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
  };
}

export const POST = createEvryPeopleAttachmentPlanPost();
