import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import {
  FORMAT_OUTPUT,
  getTemplateById,
  isDocumentFormat,
  resolveMergeValues,
  type DocumentFormat,
  type DocumentMergeValues,
} from "@/lib/documents";
import { resolveDocumentMergeContext } from "@/lib/documents/merge-context";
import { canRenderDocument, renderDocument } from "@/lib/documents/render";

// react-pdf / docx / exceljs need the Node.js runtime (not edge).
export const runtime = "nodejs";

/**
 * GET /api/documents/[templateId]?format=pdf|docx|xlsx&church_name=...&pastor_name=...
 *
 * Renders a code-defined document template and streams it as a download.
 * Format defaults to the template's first supported format. Merge values come
 * from query params; missing fields fall back to church/user auto-fill
 * defaults. Generate-on-demand (no persistence).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const { user } = await getCurrentSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { templateId } = await params;
  const template = getTemplateById(templateId);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Resolve requested format; must be one the template supports. A missing,
  // unknown, or unsupported format falls back to the template's default.
  const requested = request.nextUrl.searchParams.get("format");
  const format: DocumentFormat =
    requested &&
    isDocumentFormat(requested) &&
    template.formats.includes(requested)
      ? requested
      : template.formats[0];

  if (!canRenderDocument(format, templateId)) {
    return NextResponse.json(
      { error: "Template cannot be generated in the requested format" },
      { status: 404 }
    );
  }

  const resolved = await resolveDocumentMergeContext();
  if (!resolved) {
    return NextResponse.json(
      { error: "No church associated with this account" },
      { status: 400 }
    );
  }

  // Collect provided merge values from the query string (template fields only).
  const provided: DocumentMergeValues = {};
  for (const field of template.mergeFields) {
    const value = request.nextUrl.searchParams.get(field.key);
    if (value !== null) provided[field.key] = value;
  }

  const values = resolveMergeValues(template, resolved.context, provided);

  let file: Buffer;
  try {
    file = await renderDocument(format, templateId, values);
  } catch (error) {
    console.error(
      `[documents] failed to render ${templateId} (${format}):`,
      error
    );
    return NextResponse.json(
      { error: "Failed to generate document" },
      { status: 500 }
    );
  }

  // `?preview=1` renders inline (PDF only — browsers can't preview .docx inline).
  const { mime, ext } = FORMAT_OUTPUT[format];
  const inline =
    format === "pdf" && request.nextUrl.searchParams.get("preview") === "1";
  const disposition = inline ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(file), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${disposition}; filename="${template.id}.${ext}"`,
      "Content-Length": String(file.length),
      "Cache-Control": "no-store",
    },
  });
}
