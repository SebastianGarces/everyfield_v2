import { NextResponse } from "next/server";

import { FORMAT_OUTPUT } from "@/lib/documents/types";
import {
  generatedDocumentFilename,
  getGeneratedDocument,
} from "@/lib/documents/service";
import { getFileBytes } from "@/lib/storage";
import { authorizeEvryReadCapability } from "@/lib/evry/eligibility/capabilities";

export const runtime = "nodejs";

/** Private, tenant-scoped download handoff. Storage keys and signed URLs stay server-side. */
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

type DownloadAuthorization = Readonly<{ actor: Readonly<{ plantId: string }> }>;

export function createGeneratedDocumentDownloadHandler(boundaries: {
  authorize(): Promise<DownloadAuthorization | null>;
  findDocument: typeof getGeneratedDocument;
  readBytes: typeof getFileBytes;
}) {
  return async function handleGeneratedDocumentDownload(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    // Authorization deliberately precedes even parsing the caller's id.
    const authorization = await boundaries.authorize();
    if (!authorization) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: PRIVATE_HEADERS }
      );
    }
    const { id } = await params;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id
      )
    ) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: PRIVATE_HEADERS }
      );
    }
    const document = await boundaries.findDocument(
      authorization.actor.plantId,
      id
    );
    if (!document) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: PRIVATE_HEADERS }
      );
    }
    const stored = await boundaries.readBytes(document.storageKey);
    if (!stored) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: PRIVATE_HEADERS }
      );
    }
    const filename = generatedDocumentFilename(
      document.templateId,
      document.format
    );
    const body = stored.body.buffer.slice(
      stored.body.byteOffset,
      stored.body.byteOffset + stored.body.byteLength
    ) as ArrayBuffer;
    return new NextResponse(body, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": FORMAT_OUTPUT[document.format].mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(stored.body.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

export const GET = createGeneratedDocumentDownloadHandler({
  authorize: () => authorizeEvryReadCapability("documents.history.download"),
  findDocument: getGeneratedDocument,
  readBytes: getFileBytes,
});
