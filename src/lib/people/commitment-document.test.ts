import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commitmentDocumentRefusal,
  COMMITMENT_DOCUMENT_ACCEPT,
  isAllowedCommitmentFileType,
} from "./commitment-document";

test("commitment document policy is exactly PDF, JPEG, and PNG", () => {
  assert.equal(
    COMMITMENT_DOCUMENT_ACCEPT,
    ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
  );
  assert.deepEqual(
    ["application/pdf", "image/jpeg", "image/png"].map(
      isAllowedCommitmentFileType
    ),
    [true, true, true]
  );
  assert.deepEqual(commitmentDocumentRefusal({ type: "image/webp", size: 4 }), {
    code: "unsupported_file_type",
    message: "Choose a PDF, JPEG, or PNG file.",
  });
});
