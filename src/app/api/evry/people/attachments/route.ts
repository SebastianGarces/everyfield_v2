import { NextResponse } from "next/server";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import { stageEvryPeopleAttachment } from "@/lib/evry/capabilities/people/attachments";
import {
  authorizeEvryEffectCapability,
  authorizeEvryReadCapability,
} from "@/lib/evry/eligibility/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

export async function POST(request: Request) {
  try {
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
        ? await authorizeEvryEffectCapability(
            kind === "person_photo"
              ? "people.crm.people.upload-person-photo"
              : "people.crm.assessments.create-commitment"
          )
        : await authorizeEvryReadCapability(
            "people.crm.imports.preview-import"
          );
    if (!authorization)
      return NextResponse.json(
        { status: "unavailable" },
        { status: 404, headers: PRIVATE_HEADERS }
      );
    const result = await stageEvryPeopleAttachment({
      actor: authorization.actor,
      kind,
      personId,
      file,
    });
    return result
      ? NextResponse.json(
          { status: "staged", ...result },
          { headers: PRIVATE_HEADERS }
        )
      : NextResponse.json(
          { status: "invalid" },
          { status: 400, headers: PRIVATE_HEADERS }
        );
  } catch (error) {
    return NextResponse.json(
      { status: isUnauthorized(error) ? "unavailable" : "failed" },
      { status: isUnauthorized(error) ? 401 : 500, headers: PRIVATE_HEADERS }
    );
  }
}
