import assert from "node:assert/strict";
import type { CompiledFixtureRequest } from "./process-contract";

type Upload = NonNullable<CompiledFixtureRequest["attachments"]>[number];

/** Fixture bytes use native chunk staging and the real binding endpoint, never a model token. */
export async function bindFixtureUpload(input: {
  upload: Upload;
  sessionId: string;
  sessionToken: string;
  actor: { userId: string; plantId: string };
  origin: string;
  onStage?(
    stage:
      | "authentication"
      | "native staging"
      | "session binding"
      | "binding response"
  ): void;
}) {
  input.onStage?.("authentication");
  const { authenticateEveCookie } = await import("../../runtime/auth");
  const { withAuthenticatedSessionId } =
    await import("@/lib/auth/session-scope");
  const { stageEvryPeopleAttachment } =
    await import("@/lib/evry/capabilities/people/attachments");
  const { eveAttachmentDescriptorSchema } =
    await import("../../runtime/attachment-contract");
  const { POST } = await import("@/app/api/evry/eve/attachments/route");
  const identity = await authenticateEveCookie(input.sessionToken);
  assert.ok(identity, "Fixture upload requires real session authentication");
  assert.equal(identity.userId, input.actor.userId);
  assert.equal(identity.plantId, input.actor.plantId);
  return withAuthenticatedSessionId(identity.appSessionId, async () => {
    input.onStage?.("native staging");
    const bytes = Buffer.from(input.upload.bytesBase64, "base64");
    assert.equal(
      bytes.toString("base64"),
      input.upload.bytesBase64,
      "Fixture bytes must use canonical base64"
    );
    const staged = await stageEvryPeopleAttachment({
      actor: identity,
      kind: input.upload.kind,
      personId: input.upload.personId,
      file: new File([new Uint8Array(bytes)], input.upload.name, {
        type: input.upload.contentType,
      }),
    });
    assert.ok(staged, "Native fixture upload must finish before binding");
    input.onStage?.("session binding");
    const response = await POST(
      new Request(`${input.origin}/api/evry/eve/attachments`, {
        method: "POST",
        headers: {
          origin: input.origin,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
          cookie: `session=${encodeURIComponent(input.sessionToken)}`,
        },
        body: JSON.stringify({
          sessionId: input.sessionId,
          reference: staged.reference,
          digest: staged.metadata.digest,
          kind: input.upload.kind,
        }),
      })
    );
    input.onStage?.("binding response");
    assert.equal(
      response.status,
      200,
      "Native binding endpoint must accept the owned staged file"
    );
    const body: unknown = await response.json();
    const descriptor = eveAttachmentDescriptorSchema.parse(
      body && typeof body === "object" && "attachment" in body
        ? body.attachment
        : null
    );
    return {
      descriptor,
      reference: staged.reference,
      digest: staged.metadata.digest,
    };
  });
}
