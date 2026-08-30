import { NextResponse } from "next/server";
import { z } from "zod";

import { isUniqueViolation } from "@/db/errors";
import { isUnauthorized } from "@/lib/auth/unauthorized";
import { EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH } from "@/lib/evry/capabilities/people/attachment-contract";
import {
  openEvryPeopleAttachmentReference,
  removeEvryPeopleAttachment,
} from "@/lib/evry/capabilities/people/attachments";
import {
  persistEvryPeopleFileReview,
  recoverEvryPeopleFileReview,
} from "@/lib/evry/capabilities/people/file-conversation";
import { EvryConversationIdempotencyError } from "@/lib/evry/conversations/repository";
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
export const EVRY_PEOPLE_PLAN_MAX_BYTES =
  EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH + 64 * 1024;
const attachmentReference = z
  .string()
  .min(1)
  .max(EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH);
const bodySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("person_photo"),
    reference: attachmentReference,
    attachmentDigest: z.string().regex(/^[0-9a-f]{64}$/),
    conversationId: z.string().uuid().nullable(),
    requestKey: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal("commitment_document"),
    reference: attachmentReference,
    attachmentDigest: z.string().regex(/^[0-9a-f]{64}$/),
    commitmentType: z.enum(["core_group", "launch_team"]),
    signedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    witness: z.string().uuid().nullable(),
    notes: z.string().max(4_000).nullable(),
    conversationId: z.string().uuid().nullable(),
    requestKey: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal("people_csv"),
    reference: attachmentReference,
    attachmentDigest: z.string().regex(/^[0-9a-f]{64}$/),
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
  removeAttachment = removeEvryPeopleAttachment,
  openAttachment = openEvryPeopleAttachmentReference,
  recoverReview = recoverEvryPeopleFileReview,
  proposePhoto = proposePeoplePhotoUpload,
}: {
  requireViewer?: typeof requireEvryPlantViewer;
  removeAttachment?: typeof removeEvryPeopleAttachment;
  openAttachment?: typeof openEvryPeopleAttachmentReference;
  recoverReview?: typeof recoverEvryPeopleFileReview;
  proposePhoto?: typeof proposePeoplePhotoUpload;
} = {}) {
  return async function evryPeopleAttachmentPlanPost(request: Request) {
    let cleanStagedConflict: (() => Promise<void>) | null = null;
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
      const removeRefusedAttachment = async () => {
        try {
          await removeAttachment({
            actor,
            reference: parsed.data.reference,
            expectedKind: parsed.data.kind,
          });
        } catch (error) {
          console.error(
            "[evry:people] failed to remove a refused attachment reference",
            error
          );
        }
      };
      cleanStagedConflict = removeRefusedAttachment;
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
      const opened = openAttachment({
        reference: parsed.data.reference,
        actor,
        expectedKind: parsed.data.kind,
      });
      if (!opened || opened.digest !== parsed.data.attachmentDigest) {
        await removeRefusedAttachment();
        return NextResponse.json(
          { status: "invalid" },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      }
      let recovered;
      try {
        recovered = await recoverReview({
          actor,
          conversationId: parsed.data.conversationId,
          requestKey: parsed.data.requestKey,
          userMessage: labels[parsed.data.kind].user,
          expectedAttachment: {
            kind: parsed.data.kind,
            digest: opened.digest,
          },
          now,
        });
      } catch (error) {
        if (!(error instanceof EvryConversationIdempotencyError)) throw error;
        await removeRefusedAttachment();
        return NextResponse.json(
          { status: "conflict" },
          { status: 409, headers: PRIVATE_HEADERS }
        );
      }
      if (recovered) {
        if (recovered.attachment.reference !== parsed.data.reference) {
          await removeRefusedAttachment();
        }
        return NextResponse.json(
          {
            status: parsed.data.conversationId ? "continued" : "created",
            conversation: publicEvryConversation(recovered.resumed),
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
        proposal = await proposePhoto({
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
      if (!proposal) {
        await removeRefusedAttachment();
        return NextResponse.json(
          { status: "unavailable" },
          { status: 404, headers: PRIVATE_HEADERS }
        );
      }
      const preview =
        parsed.data.kind === "people_csv"
          ? await readPeopleImportPreviewArtifact({
              actor,
              attachmentReference: parsed.data.reference,
              attachmentDigest: opened.digest,
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
      if (!persisted) {
        await removeRefusedAttachment();
        return NextResponse.json(
          { status: "unavailable" },
          { status: 404, headers: PRIVATE_HEADERS }
        );
      }
      return NextResponse.json(
        {
          status: parsed.data.conversationId ? "continued" : "created",
          conversation: publicEvryConversation(persisted),
        },
        {
          status: parsed.data.conversationId ? 200 : 201,
          headers: PRIVATE_HEADERS,
        }
      );
    } catch (error) {
      if (
        cleanStagedConflict &&
        (error instanceof EvryConversationIdempotencyError ||
          isUniqueViolation(
            error,
            "evry_action_plans_actor_request_unique_idx"
          ))
      ) {
        await cleanStagedConflict();
        return NextResponse.json(
          { status: "conflict" },
          { status: 409, headers: PRIVATE_HEADERS }
        );
      }
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
