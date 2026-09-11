export const COMMITMENT_DOCUMENT_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
export const MAX_COMMITMENT_FILE_SIZE = 10 * 1024 * 1024;

const COMMITMENT_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export type CommitmentDocumentRefusal = Readonly<{
  code: "unsupported_file_type" | "file_too_large";
  message: string;
}>;

export function isAllowedCommitmentFileType(mimeType: string): boolean {
  return COMMITMENT_DOCUMENT_TYPES.has(mimeType);
}

export function isValidCommitmentFileSize(size: number): boolean {
  return size <= MAX_COMMITMENT_FILE_SIZE;
}

export function commitmentDocumentRefusal(file: {
  type: string;
  size: number;
}): CommitmentDocumentRefusal | null {
  if (!isAllowedCommitmentFileType(file.type)) {
    return {
      code: "unsupported_file_type",
      message: "Choose a PDF, JPEG, or PNG file.",
    };
  }
  if (!isValidCommitmentFileSize(file.size)) {
    return {
      code: "file_too_large",
      message: "Choose a file that is 10 MB or smaller.",
    };
  }
  return null;
}
