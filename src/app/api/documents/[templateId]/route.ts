import { NextRequest, NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { getCurrentUserChurch } from "@/lib/auth/session";
import {
  getTemplateById,
  resolveMergeValues,
  type DocumentMergeValues,
} from "@/lib/documents";
import { renderDocumentPdf, hasRenderer } from "@/lib/documents/pdf";

// react-pdf needs the Node.js runtime (not edge).
export const runtime = "nodejs";

/**
 * GET /api/documents/[templateId]?church_name=...&pastor_name=...
 *
 * Renders a code-defined document template to a PDF and streams it as a
 * download. Merge values come from query params; any missing field falls back
 * to the church/user auto-fill defaults. Generate-on-demand (no persistence).
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
  if (!template || !hasRenderer(templateId)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
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

  let pdf: Buffer;
  try {
    pdf = await renderDocumentPdf(templateId, values);
  } catch (error) {
    console.error(`[documents] failed to render ${templateId}:`, error);
    return NextResponse.json(
      { error: "Failed to generate document" },
      { status: 500 }
    );
  }

  // `?preview=1` renders inline (for in-browser preview); otherwise download.
  const inline = request.nextUrl.searchParams.get("preview") === "1";
  const fileName = `${template.id}.pdf`;
  const disposition = inline ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
}
