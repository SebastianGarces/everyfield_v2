import { ForbiddenError } from "eve/channels/auth";
import { isUnauthorized, UnauthorizedError } from "@/lib/auth/unauthorized";
import { EvryPlantViewerRefusalError } from "@/lib/evry/eligibility/viewer";

export const EVE_TOOL_FAILURE_MESSAGE =
  "The requested capability could not complete.";

/** Rejections become model input in Eve. Never carry private exception data. */
export async function withSafeEveToolErrors<T>(
  signal: AbortSignal | undefined,
  work: () => Promise<T>
): Promise<T> {
  try {
    if (signal?.aborted)
      throw new DOMException("The request was cancelled.", "AbortError");
    return await work();
  } catch (error) {
    // Reconstruct the known refusal types so their status/digest survives,
    // without copying a cause or other properties attached by a dependency.
    if (isUnauthorized(error)) throw new UnauthorizedError();
    if (error instanceof ForbiddenError)
      throw new ForbiddenError({ message: "Conversation unavailable." });
    if (error instanceof EvryPlantViewerRefusalError)
      throw new EvryPlantViewerRefusalError();
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw new DOMException("The request was cancelled.", "AbortError");
    throw new Error(EVE_TOOL_FAILURE_MESSAGE);
  }
}
