import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { getCurrentUserChurch } from "@/lib/auth/session";
import {
  FORMAT_OUTPUT,
  getTemplateById,
  resolveMergeValues,
  type DocumentFormat,
  type DocumentMergeValues,
} from "@/lib/documents";
import { hasDocxRenderer, renderDocumentDocx } from "@/lib/documents/docx";
import { hasRenderer, renderDocumentPdf } from "@/lib/documents/pdf";

// react-pdf / docx need the Node.js runtime (not edge).
export const runtime = "nodejs";

/**
 * GET /api/documents/[templateId]?format=pdf|docx&church_name=...&pastor_name=...
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

  // Resolve requested format; must be one the template supports.
  const requested = request.nextUrl.searchParams.get("format");
  const format: DocumentFormat = (
    requested && template.formats.includes(requested as DocumentFormat)
      ? requested
      : template.formats[0]
  ) as DocumentFormat;

  const hasFor =
    format === "docx" ? hasDocxRenderer(templateId) : hasRenderer(templateId);
  if (!hasFor) {
    return NextResponse.json(
      { error: "Template cannot be generated in the requested format" },
      { status: 404 }
    );
  }

  const church = await getCurrentUserChurch();
  if (!church) {
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

  const values = resolveMergeValues(
    template,
    {
      churchName: church.name,
      userName: user.name ?? null,
      // `churches.launch_date` lands with the Phase Engine schema (not on main yet).
      launchDate: null,
    },
    provided
  );

  let file: Buffer;
  try {
    file =
      format === "docx"
        ? await renderDocumentDocx(templateId, values)
        : await renderDocumentPdf(templateId, values);
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
