"use server";

import type { Assessment, Commitment, Interview } from "@/db/schema";
import { logPersonActivity } from "@/lib/people/activity";
import { createAssessment, createInterview } from "@/lib/people/assessments";
import { createCommitment, getCommitment } from "@/lib/people/commitments";
import { assertPersonInChurch } from "@/lib/people/service";
import { changeStatus } from "@/lib/people/status";
import type { ActionResult } from "@/lib/people/types";
import {
  getExtensionFromMimeType,
  getSignedDownloadUrl,
  isAllowedCommitmentFileType,
  isValidCommitmentFileSize,
  uploadFile,
} from "@/lib/storage";
import {
  assessmentCreateSchema,
  commitmentCreateSchema,
  interviewCreateSchema,
} from "@/lib/validations/people";
import { revalidatePath } from "next/cache";
import { toFieldErrors, withChurchSession } from "./action-context";

// ============================================================================
// Assessment Actions (4 C's)
// ============================================================================

/**
 * Create a 4 C's assessment for a person.
 * Logs assessment_completed activity.
 */
export async function createAssessmentAction(
  personId: string,
  data: {
    committedScore: number;
    committedNotes?: string;
    compelledScore: number;
    compelledNotes?: string;
    contagiousScore: number;
    contagiousNotes?: string;
    courageousScore: number;
    courageousNotes?: string;
    assessmentDate: string;
  }
): Promise<ActionResult<Assessment>> {
  return withChurchSession(
    "createAssessmentAction",
    {
      fallback: "Failed to create assessment",
    },
    async ({ user, churchId }) => {
      // Validate input
      const parsed = assessmentCreateSchema.safeParse({
        personId,
        ...data,
      });

      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      // Never write against a personId the caller's church does not own
      await assertPersonInChurch(churchId, personId);

      // Create the assessment
      const assessment = await createAssessment(churchId, user.id, parsed.data);

      // Log activity
      await logPersonActivity({
        churchId,
        personId,
        activityType: "assessment_completed",
        metadata: {
          assessmentId: assessment.id,
          totalScore: assessment.totalScore,
          committedScore: assessment.committedScore,
          compelledScore: assessment.compelledScore,
          contagiousScore: assessment.contagiousScore,
          courageousScore: assessment.courageousScore,
        },
        performedBy: user.id,
      });

      revalidatePath(`/people/${personId}`);
      revalidatePath(`/people/${personId}/assessments`);

      return { success: true, data: assessment };
    }
  );
}

// ============================================================================
// Interview Actions
// ============================================================================

/**
 * Create an interview record for a person.
 * Logs interview_completed activity and auto-advances to 'interviewed' status.
 */
export async function createInterviewAction(
  personId: string,
  data: {
    interviewDate: string;
    maturityStatus: "pass" | "fail" | "concern";
    maturityNotes?: string;
    giftedStatus: "pass" | "fail" | "concern";
    giftedNotes?: string;
    chemistryStatus: "pass" | "fail" | "concern";
    chemistryNotes?: string;
    rightReasonsStatus: "pass" | "fail" | "concern";
    rightReasonsNotes?: string;
    seasonStatus: "pass" | "fail" | "concern";
    seasonNotes?: string;
    overallResult:
      | "qualified"
      | "qualified_with_notes"
      | "not_qualified"
      | "follow_up";
    nextSteps?: string;
  }
): Promise<ActionResult<Interview>> {
  return withChurchSession(
    "createInterviewAction",
    {
      fallback: "Failed to create interview",
    },
    async ({ user, churchId }) => {
      // Validate input
      const parsed = interviewCreateSchema.safeParse({
        personId,
        ...data,
      });

      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      // Never write against a personId the caller's church does not own
      await assertPersonInChurch(churchId, personId);

      // Create the interview
      const interview = await createInterview(churchId, user.id, parsed.data);

      // Log interview_completed activity
      await logPersonActivity({
        churchId,
        personId,
        activityType: "interview_completed",
        metadata: {
          interviewId: interview.id,
          overallResult: interview.overallResult,
          maturityStatus: interview.maturityStatus,
          giftedStatus: interview.giftedStatus,
          chemistryStatus: interview.chemistryStatus,
          rightReasonsStatus: interview.rightReasonsStatus,
          seasonStatus: interview.seasonStatus,
        },
        performedBy: user.id,
      });

      // Auto-advance to 'interviewed' status
      // changeStatus handles activity logging and event emission
      await changeStatus(churchId, personId, user.id, "interviewed");

      revalidatePath(`/people/${personId}`);
      revalidatePath(`/people/${personId}/assessments`);
      revalidatePath("/people");

      return { success: true, data: interview };
    }
  );
}

// ============================================================================
// Commitment Actions
// ============================================================================

/**
 * Create a commitment record for a person.
 * Handles file upload if a document is provided.
 * Logs commitment_recorded activity and auto-advances to 'core_group' status.
 */
export async function createCommitmentAction(
  formData: FormData
): Promise<ActionResult<Commitment>> {
  return withChurchSession(
    "createCommitmentAction",
    {
      fallback: "Failed to create commitment",
    },
    async ({ user, churchId }) => {
      // Extract form fields
      const personId = formData.get("personId") as string;
      const commitmentType = formData.get("commitmentType") as string;
      const signedDate = formData.get("signedDate") as string;
      const witnessedBy = formData.get("witnessedBy") as string | null;
      const notes = formData.get("notes") as string | null;
      const file = formData.get("document") as File | null;

      // Validate input
      const parsed = commitmentCreateSchema.safeParse({
        personId,
        commitmentType,
        signedDate,
        witnessedBy: witnessedBy || undefined,
        notes: notes || undefined,
      });

      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      // Never write against a personId the caller's church does not own —
      // checked BEFORE the upload so no file lands for a foreign person
      await assertPersonInChurch(churchId, parsed.data.personId);

      // Handle file upload if provided
      let documentKey: string | undefined;

      if (file && file.size > 0) {
        // Validate file type
        if (!isAllowedCommitmentFileType(file.type)) {
          return {
            success: false,
            error:
              "Invalid file type. Only PDF, JPG, and PNG files are allowed.",
          };
        }

        // Validate file size
        if (!isValidCommitmentFileSize(file.size)) {
          return {
            success: false,
            error: "File is too large. Maximum size is 10MB.",
          };
        }

        // Generate a temporary ID for the file key (will be replaced with actual commitment ID)
        const tempId = crypto.randomUUID();
        const extension = getExtensionFromMimeType(file.type);
        documentKey = `commitments/${churchId}/${personId}/${tempId}.${extension}`;

        // Upload the file
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        await uploadFile(documentKey, fileBuffer, file.type);
      }

      // Create the commitment
      const commitment = await createCommitment(
        churchId,
        user.id,
        parsed.data,
        documentKey
      );

      // Log commitment_recorded activity
      await logPersonActivity({
        churchId,
        personId,
        activityType: "commitment_recorded",
        metadata: {
          commitmentId: commitment.id,
          commitmentType: commitment.commitmentType,
          signedDate: commitment.signedDate,
          hasDocument: !!documentKey,
        },
        performedBy: user.id,
      });

      // Auto-advance to 'core_group' status (commitment = Core Group entry)
      // changeStatus handles activity logging and event emission
      await changeStatus(churchId, personId, user.id, "core_group");

      revalidatePath(`/people/${personId}`);
      revalidatePath(`/people/${personId}/assessments`);
      revalidatePath("/people");

      return { success: true, data: commitment };
    }
  );
}

/**
 * Get a signed download URL for a commitment document.
 * The URL triggers a browser download when accessed.
 */
export async function getCommitmentDownloadUrlAction(
  commitmentId: string
): Promise<ActionResult<{ url: string }>> {
  return withChurchSession(
    "getCommitmentDownloadUrlAction",
    { fallback: "Failed to generate download URL" },
    async ({ churchId }) => {
      // Get the commitment to verify access and get the document key
      const commitment = await getCommitment(churchId, commitmentId);

      if (!commitment) {
        return { success: false, error: "Commitment not found" };
      }

      if (!commitment.documentUrl) {
        return {
          success: false,
          error: "No document attached to this commitment",
        };
      }

      // Generate filename for download
      const extension = commitment.documentUrl.split(".").pop() || "pdf";
      const filename = `commitment-${commitment.commitmentType}-${commitment.signedDate}.${extension}`;

      // Generate signed URL with Content-Disposition header
      const url = await getSignedDownloadUrl(
        commitment.documentUrl,
        filename,
        3600 // 1 hour expiry
      );

      return { success: true, data: { url } };
    }
  );
}
