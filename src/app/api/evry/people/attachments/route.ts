import { NextResponse } from "next/server";
import { z } from "zod";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import {
  finalizeEvryPeopleAttachmentUpload,
  prepareEvryPeopleAttachmentUpload,
  storeEvryPeopleAttachmentChunk,
} from "@/lib/evry/capabilities/people/attachments";
import {
  EVRY_PEOPLE_ATTACHMENT_ROUTE_MAX_BYTES,
  EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH,
} from "@/lib/evry/capabilities/people/attachment-contract";
import { readPeopleImportPreviewArtifact } from "@/lib/evry/capabilities/people/file-reads";
import {
  authorizeEvryEffectCapability,
  authorizeEvryReadCapability,
} from "@/lib/evry/eligibility/capabilities";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
} from "@/lib/evry/eligibility/viewer";
import { commitmentDocumentRefusal } from "@/lib/people/commitment-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;
export const EVRY_PEOPLE_MULTIPART_MAX_BYTES =
  EVRY_PEOPLE_ATTACHMENT_ROUTE_MAX_BYTES;

const kindSchema = z.enum([
  "person_photo",
  "people_csv",
  "commitment_document",
]);
const prepareSchema = z.strictObject({
  action: z.literal("prepare"),
  kind: kindSchema,
  personId: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(100),
  size: z.number().int().positive(),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
});
const finalizeSchema = z.strictObject({
  action: z.literal("finalize"),
  kind: kindSchema,
  reference: z
    .string()
    .min(1)
    .max(EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH),
});

type Kind = z.infer<typeof kindSchema>;

export function createEvryPeopleAttachmentPost({
  requireViewer = requireEvryPlantViewer,
  authorizeEffect = authorizeEvryEffectCapability,
  authorizeRead = authorizeEvryReadCapability,
  prepare = prepareEvryPeopleAttachmentUpload,
  storeChunk = storeEvryPeopleAttachmentChunk,
  finalize = finalizeEvryPeopleAttachmentUpload,
  preview = readPeopleImportPreviewArtifact,
}: {
  requireViewer?: typeof requireEvryPlantViewer;
  authorizeEffect?: typeof authorizeEvryEffectCapability;
  authorizeRead?: typeof authorizeEvryReadCapability;
  prepare?: typeof prepareEvryPeopleAttachmentUpload;
  storeChunk?: typeof storeEvryPeopleAttachmentChunk;
  finalize?: typeof finalizeEvryPeopleAttachmentUpload;
  preview?: typeof readPeopleImportPreviewArtifact;
} = {}) {
  return async function evryPeopleAttachmentPost(request: Request) {
    try {
      const viewer = await requireViewer();
      const contentLength = Number(request.headers.get("content-length"));
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength <= 0 ||
        contentLength > EVRY_PEOPLE_MULTIPART_MAX_BYTES
      ) {
        return NextResponse.json(
          { status: "invalid" },
          { status: 413, headers: PRIVATE_HEADERS }
        );
      }

      const authorize = async (kind: Kind) => {
        const authorization =
          kind === "person_photo" || kind === "commitment_document"
            ? await authorizeEffect(
                kind === "person_photo"
                  ? "people.crm.people.upload-person-photo"
                  : "people.crm.assessments.create-commitment"
              )
            : await authorizeRead("people.crm.imports.preview-import");
        return authorization &&
          authorization.actor.userId === viewer.userId &&
          authorization.actor.plantId === viewer.plantId
          ? authorization
          : null;
      };

      if (request.headers.get("content-type")?.startsWith("application/json")) {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return NextResponse.json(
            { status: "invalid" },
            { status: 400, headers: PRIVATE_HEADERS }
          );
        }
        const preparing = prepareSchema.safeParse(raw);
        if (preparing.success) {
          const authorization = await authorize(preparing.data.kind);
          if (!authorization)
            return NextResponse.json(
              { status: "unavailable" },
              { status: 404, headers: PRIVATE_HEADERS }
            );
          if (preparing.data.kind === "commitment_document") {
            const refusal = commitmentDocumentRefusal({
              type: preparing.data.type,
              size: preparing.data.size,
            });
            if (refusal)
              return NextResponse.json(
                { status: "invalid", reason: refusal.code },
                { status: 400, headers: PRIVATE_HEADERS }
              );
          }
          const result = await prepare({
            actor: authorization.actor,
            kind: preparing.data.kind,
            personId: preparing.data.personId,
            name: preparing.data.name,
            type: preparing.data.type,
            size: preparing.data.size,
            digest: preparing.data.digest,
          });
          return result
            ? NextResponse.json(
                { status: "prepared", ...result },
                { headers: PRIVATE_HEADERS }
              )
            : NextResponse.json(
                { status: "invalid" },
                { status: 400, headers: PRIVATE_HEADERS }
              );
        }
        const finalizing = finalizeSchema.safeParse(raw);
        if (!finalizing.success)
          return NextResponse.json(
            { status: "invalid" },
            { status: 400, headers: PRIVATE_HEADERS }
          );
        const authorization = await authorize(finalizing.data.kind);
        if (!authorization)
          return NextResponse.json(
            { status: "unavailable" },
            { status: 404, headers: PRIVATE_HEADERS }
          );
        const result = await finalize({
          actor: authorization.actor,
          kind: finalizing.data.kind,
          reference: finalizing.data.reference,
        });
        if (!result)
          return NextResponse.json(
            { status: "invalid" },
            { status: 400, headers: PRIVATE_HEADERS }
          );
        const artifact =
          finalizing.data.kind === "people_csv"
            ? await preview({
                actor: authorization.actor,
                attachmentReference: result.reference,
                attachmentDigest: result.metadata.digest,
              })
            : null;
        return NextResponse.json(
          { status: "staged", ...result, ...(artifact ? { artifact } : {}) },
          { headers: PRIVATE_HEADERS }
        );
      }

      const form = await request.formData();
      const action = form.get("action");
      const kind = kindSchema.safeParse(form.get("kind"));
      const reference = form.get("reference");
      const index = Number(form.get("index"));
      const chunk = form.get("chunk");
      const keys = [...form.keys()];
      if (
        action !== "chunk" ||
        !kind.success ||
        typeof reference !== "string" ||
        reference.length >
          EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        !(chunk instanceof File) ||
        form.getAll("action").length !== 1 ||
        form.getAll("kind").length !== 1 ||
        form.getAll("reference").length !== 1 ||
        form.getAll("index").length !== 1 ||
        form.getAll("chunk").length !== 1 ||
        keys.some(
          (key) =>
            !["action", "kind", "reference", "index", "chunk"].includes(key)
        )
      )
        return NextResponse.json(
          { status: "invalid" },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      const authorization = await authorize(kind.data);
      if (!authorization)
        return NextResponse.json(
          { status: "unavailable" },
          { status: 404, headers: PRIVATE_HEADERS }
        );
      const stored = await storeChunk({
        actor: authorization.actor,
        kind: kind.data,
        reference,
        chunkIndex: index,
        bytes: Buffer.from(await chunk.arrayBuffer()),
      });
      return stored
        ? NextResponse.json(
            { status: "accepted", index },
            { headers: PRIVATE_HEADERS }
          )
        : NextResponse.json(
            { status: "invalid" },
            { status: 400, headers: PRIVATE_HEADERS }
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

export const POST = createEvryPeopleAttachmentPost();
