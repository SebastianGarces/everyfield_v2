import type { EvryPeopleFileSubmission } from "../evry-shell";
import { eveAttachmentDescriptorSchema } from "@/lib/evry/eve/runtime/attachment-contract";
import type { PreparedEvryPeopleFile } from "../people-file-state";
import {
  preparedEvryPeopleUploadFromResponse,
  preparedEvryPeopleFileFromStage,
} from "../people-file-state";

/** Staging uploads bytes only. Eve's preparation tools still require exact review. */
export async function stagePeopleFile(input: EvryPeopleFileSubmission) {
  const fileBytes = await input.file.arrayBuffer();
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes)),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
  const prepareResponse = await fetch("/api/evry/people/attachments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "prepare",
      kind: input.kind,
      personId: "personId" in input ? input.personId : null,
      name: input.file.name,
      type: input.file.type,
      size: input.file.size,
      digest,
    }),
  });
  const upload: unknown = await prepareResponse.json();
  const manifest = preparedEvryPeopleUploadFromResponse(upload);
  if (!prepareResponse.ok || !manifest) {
    const reason =
      typeof upload === "object" &&
      upload !== null &&
      "reason" in upload &&
      typeof upload.reason === "string"
        ? upload.reason
        : null;
    throw new Error(
      reason === "unsupported_file_type"
        ? "Choose a PDF, JPEG, or PNG file."
        : reason === "file_too_large"
          ? "Choose a file that is 10 MB or smaller."
          : "Unable to prepare this file."
    );
  }
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const form = new FormData();
    form.set("action", "chunk");
    form.set("kind", input.kind);
    form.set("reference", manifest.reference);
    form.set("index", String(index));
    form.set(
      "chunk",
      new File(
        [
          input.file.slice(
            index * manifest.chunkBytes,
            (index + 1) * manifest.chunkBytes
          ),
        ],
        `${input.file.name}.part`,
        { type: "application/octet-stream" }
      )
    );
    const chunkResponse = await fetch("/api/evry/people/attachments", {
      method: "POST",
      body: form,
    });
    if (!chunkResponse.ok) throw new Error("Unable to prepare this file.");
  }
  const stagedResponse = await fetch("/api/evry/people/attachments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "finalize",
      kind: input.kind,
      reference: manifest.reference,
    }),
  });
  const staged: unknown = await stagedResponse.json();
  const prepared = preparedEvryPeopleFileFromStage(staged);
  if (!stagedResponse.ok || !prepared) {
    const reason =
      typeof staged === "object" &&
      staged !== null &&
      "reason" in staged &&
      typeof staged.reason === "string"
        ? staged.reason
        : null;
    throw new Error(
      reason === "unsupported_file_type"
        ? "Choose a PDF, JPEG, or PNG file."
        : reason === "file_too_large"
          ? "Choose a file that is 10 MB or smaller."
          : "Unable to prepare this file."
    );
  }
  return prepared;
}

/** Idempotently associate the already-staged bytes with the client's owned Eve session. */
export class EveAttachmentUnavailableError extends Error {
  constructor() {
    super(
      "This upload is no longer available. Try again to upload the selected file."
    );
    this.name = "EveAttachmentUnavailableError";
  }
}

export async function bindPeopleFile(
  sessionId: string,
  kind: EvryPeopleFileSubmission["kind"],
  prepared: PreparedEvryPeopleFile
) {
  const response = await fetch("/api/evry/eve/attachments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      kind,
      reference: prepared.reference,
      digest: prepared.digest,
    }),
  });
  if (response.status === 404) throw new EveAttachmentUnavailableError();
  const value: unknown = await response.json();
  if (
    !response.ok ||
    !value ||
    typeof value !== "object" ||
    !("attachment" in value)
  )
    throw new Error(
      "Unable to attach this file. Keep it selected and try again."
    );
  return eveAttachmentDescriptorSchema.parse(value.attachment);
}
