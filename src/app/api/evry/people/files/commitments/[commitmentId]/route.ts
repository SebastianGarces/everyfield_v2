import { authorizeEvryReadCapability } from "@/lib/evry/eligibility/capabilities";
import { getCommitment } from "@/lib/people/commitments";
import { getSignedDownloadUrl } from "@/lib/storage";
import { z } from "zod";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ commitmentId: string }> }
) {
  const privateHeaders = { "cache-control": "private, no-store" } as const;
  const authorization = await authorizeEvryReadCapability(
    "people.crm.assessments.get-commitment-download-url"
  );
  if (!authorization)
    return new Response("Not found", {
      status: 404,
      headers: privateHeaders,
    });
  const { commitmentId } = await params;
  if (!z.string().uuid().safeParse(commitmentId).success)
    return new Response("Not found", {
      status: 404,
      headers: privateHeaders,
    });
  const commitment = await getCommitment(
    authorization.actor.plantId,
    commitmentId
  );
  if (!commitment?.documentUrl)
    return new Response("Not found", {
      status: 404,
      headers: privateHeaders,
    });
  const extension = commitment.documentUrl.split(".").pop() || "pdf";
  const filename = `commitment-${commitment.commitmentType}-${commitment.signedDate}.${extension}`;
  return new Response(null, {
    status: 303,
    headers: {
      ...privateHeaders,
      location: await getSignedDownloadUrl(
        commitment.documentUrl,
        filename,
        300
      ),
    },
  });
}
