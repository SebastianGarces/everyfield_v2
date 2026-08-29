import { NextResponse } from "next/server";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import { stageEvryPeopleAttachment } from "@/lib/evry/capabilities/people/attachments";
import { readPeopleImportPreviewArtifact } from "@/lib/evry/capabilities/people/file-reads";
import {
  authorizeEvryEffectCapability,
  authorizeEvryReadCapability,
} from "@/lib/evry/eligibility/capabilities";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
} from "@/lib/evry/eligibility/viewer";
import { MAX_COMMITMENT_FILE_SIZE } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;
export const EVRY_PEOPLE_MULTIPART_MAX_BYTES =
  MAX_COMMITMENT_FILE_SIZE + 64 * 1024;

export function createEvryPeopleAttachmentPost({
  requireViewer = requireEvryPlantViewer,
  authorizeEffect = authorizeEvryEffectCapability,
  authorizeRead = authorizeEvryReadCapability,
  stage = stageEvryPeopleAttachment,
  preview = readPeopleImportPreviewArtifact,
}: {
  requireViewer?: typeof requireEvryPlantViewer;
  authorizeEffect?: typeof authorizeEvryEffectCapability;
  authorizeRead?: typeof authorizeEvryReadCapability;
  stage?: typeof stageEvryPeopleAttachment;
  preview?: typeof readPeopleImportPreviewArtifact;
} = {}) {
  return async function evryPeopleAttachmentPost(request: Request) {
    try {
      // Authenticate before parsing or buffering any caller-controlled multipart
      // body. A browser multipart request always carries Content-Length here;
      // rejecting an absent/invalid length keeps chunked bodies from bypassing
      // the same hard boundary.
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
      const form = await request.formData();
      const kind = form.get("kind");
      const personIdValue = form.get("personId");
      const personId = typeof personIdValue === "string" ? personIdValue : null;
      const file = form.get("file");
      const keys = [...form.keys()];
      if (
        !(file instanceof File) ||
        form.getAll("kind").length !== 1 ||
        form.getAll("file").length !== 1 ||
        form.getAll("personId").length > 1 ||
        keys.some((key) => !["kind", "personId", "file"].includes(key)) ||
        (kind !== "person_photo" &&
          kind !== "people_csv" &&
          kind !== "commitment_document")
      )
        return NextResponse.json(
          { status: "invalid" },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      const authorization =
        kind === "person_photo" || kind === "commitment_document"
          ? await authorizeEffect(
              kind === "person_photo"
                ? "people.crm.people.upload-person-photo"
                : "people.crm.assessments.create-commitment"
            )
          : await authorizeRead("people.crm.imports.preview-import");
      if (!authorization)
        return NextResponse.json(
          { status: "unavailable" },
          { status: 404, headers: PRIVATE_HEADERS }
        );
      if (
        authorization.actor.userId !== viewer.userId ||
        authorization.actor.plantId !== viewer.plantId
      ) {
        return NextResponse.json(
          { status: "unavailable" },
          { status: 404, headers: PRIVATE_HEADERS }
        );
      }
      const result = await stage({
        actor: authorization.actor,
        kind,
        personId,
        file,
      });
      if (!result)
        return NextResponse.json(
          { status: "invalid" },
          { status: 400, headers: PRIVATE_HEADERS }
        );
      const artifact =
        kind === "people_csv"
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
