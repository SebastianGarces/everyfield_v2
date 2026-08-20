"use server";

// ============================================================================
// Generated-document history writes
// ============================================================================
//
// The export list of a `"use server"` module IS the auth surface. This file
// holds the re-download action and nothing else; list and persist live in
// `@/lib/documents/service`, which has no directive.
//
// SESSION FIRST, THEN THE PARSE, ABOVE THE TRY. The client names an artifact
// id, never a storage key and never a church. The session's church is what
// the lookup re-asserts; a foreign uuid reads as missing.
// ============================================================================

import { requireSeat } from "@/lib/auth/seats";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { getGeneratedDocumentDownloadUrl } from "@/lib/documents/service";

const downloadInputSchema = z.strictObject({
  id: z.uuid(),
});

export async function getGeneratedDocumentDownloadUrlAction(
  input: unknown
): Promise<GeneratedDocumentDownloadResult> {
  const { user } = await requireSeat("read");

  const parsed = downloadInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Document not found" };
  }

  if (!user.churchId) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const url = await getGeneratedDocumentDownloadUrl(
      user.churchId,
      parsed.data.id
    );
    if (!url) {
      return { success: false, error: "Document not found" };
    }
    return { success: true, data: { url } };
  } catch (error) {
    unstable_rethrow(error);
    console.error("getGeneratedDocumentDownloadUrlAction error:", error);
    return { success: false, error: "Failed to generate download URL" };
  }
}

export type GeneratedDocumentDownloadResult =
  | { success: true; data: { url: string } }
  | { success: false; error: string };
