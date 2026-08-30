import { z } from "zod";

import {
  parseEvryRunRecoveryResponse,
  type EvryRunRecoveryResponse,
} from "@/lib/evry/runs/wire";

const STORAGE_KEY = "evry.active-run.v1";
const ordinaryMarkerSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().uuid(),
    kind: z.enum(["conversation", "execution"]),
    conversationId: z.string().uuid().nullable(),
  })
  .strict()
  .readonly();

const reuseMarkerSchema = z
  .object({
    version: z.literal(2),
    requestId: z.string().uuid(),
    kind: z.literal("conversation"),
    operation: z.literal("reuse"),
    conversationId: z.string().uuid().nullable(),
    sourceConversationId: z.string().uuid(),
    resultArtifactId: z.string().uuid(),
    recipeIdentity: z.string().trim().min(1).max(160),
    sourceLocation: z
      .object({ pathname: z.string().min(1), search: z.string() })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();

const markerSchema = z.union([ordinaryMarkerSchema, reuseMarkerSchema]);

export type EvryRunRecoveryMarker = z.infer<typeof markerSchema>;
export type EvryRecipeReuseRecoveryMarker = z.infer<typeof reuseMarkerSchema>;

export function isEvryRecipeReuseRecoveryMarker(
  marker: EvryRunRecoveryMarker
): marker is EvryRecipeReuseRecoveryMarker {
  return marker.version === 2;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function readEvryRunRecoveryMarker(
  storage: Storage | null = browserStorage()
): EvryRunRecoveryMarker | null {
  if (!storage) return null;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return markerSchema.parse(JSON.parse(raw));
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function writeEvryRunRecoveryMarker(
  marker:
    | Omit<z.infer<typeof ordinaryMarkerSchema>, "version">
    | Omit<EvryRecipeReuseRecoveryMarker, "version">,
  storage: Storage | null = browserStorage()
): void {
  if (!storage) return;
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      markerSchema.parse({
        version: "operation" in marker ? 2 : 1,
        ...marker,
      })
    )
  );
}

export function bindEvryRunRecoveryConversation(
  requestId: string,
  conversationId: string,
  storage: Storage | null = browserStorage()
): void {
  const marker = readEvryRunRecoveryMarker(storage);
  if (!marker || marker.requestId !== requestId) return;
  writeEvryRunRecoveryMarker({ ...marker, conversationId }, storage);
}

export function clearEvryRunRecoveryMarker(
  requestId: string,
  storage: Storage | null = browserStorage()
): void {
  const marker = readEvryRunRecoveryMarker(storage);
  if (marker?.requestId === requestId) storage?.removeItem(STORAGE_KEY);
}

export function markerMatchesEvryLocation(
  marker: EvryRunRecoveryMarker,
  location: Readonly<{ pathname: string; search: string }>
): boolean {
  if (isEvryRecipeReuseRecoveryMarker(marker)) {
    if (
      location.pathname === marker.sourceLocation.pathname &&
      location.search === marker.sourceLocation.search
    ) {
      return true;
    }
    if (location.pathname !== "/evry" || marker.conversationId === null) {
      return false;
    }
    return (
      new URLSearchParams(location.search).get("conversation") ===
      marker.conversationId
    );
  }
  if (location.pathname !== "/evry") return true;
  const params = new URLSearchParams(location.search);
  if (params.get("new") === "1") return marker.conversationId === null;
  const selected = params.get("conversation");
  return selected !== null && selected === marker.conversationId;
}

const MAX_OBSERVATION_MS = 16 * 60 * 1_000;
const PRECLAIM_GRACE_READS = 6;
const MAX_RESUME_ATTEMPTS = 3;

type FetchRecovery = (
  requestId: string,
  mode: "read" | "resume",
  signal: AbortSignal
) => Promise<unknown>;

async function defaultFetchRecovery(
  requestId: string,
  mode: "read" | "resume",
  signal: AbortSignal
): Promise<unknown> {
  const response = await fetch(
    `/api/evry/runs/${encodeURIComponent(requestId)}`,
    mode === "read"
      ? { cache: "no-store", signal }
      : {
          method: "POST",
          cache: "no-store",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "resume" }),
        }
  );
  if (!response.ok) throw new Error("Evry run recovery was unavailable");
  return response.json();
}

function validateSnapshot(
  marker: EvryRunRecoveryMarker,
  input: unknown
): EvryRunRecoveryResponse {
  const snapshot = parseEvryRunRecoveryResponse(input);
  if (snapshot.requestId !== marker.requestId) {
    throw new Error("Evry recovery response did not match its request");
  }
  if ("kind" in snapshot && snapshot.kind !== marker.kind) {
    throw new Error("Evry recovery response changed run kind");
  }
  if (
    isEvryRecipeReuseRecoveryMarker(marker) &&
    snapshot.status === "active" &&
    snapshot.operation !== "reuse"
  ) {
    throw new Error("Evry recovery response changed reuse operation");
  }
  const conversationId =
    snapshot.status === "durable"
      ? snapshot.conversation.id
      : snapshot.status === "active" || snapshot.status === "resumable"
        ? snapshot.conversationId
        : snapshot.status === "expired"
          ? snapshot.conversationId
          : null;
  if (
    marker.conversationId !== null &&
    conversationId !== null &&
    conversationId !== marker.conversationId
  ) {
    throw new Error("Evry recovery response changed conversation");
  }
  return snapshot;
}

function waitForRecovery(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Observation stopped", "AbortError"));
      },
      { once: true }
    );
  });
}

/** Poll one durable identity only until it settles, expires, or is detached. */
export async function reconnectEvryRun(input: {
  marker: EvryRunRecoveryMarker;
  signal: AbortSignal;
  onActive(
    snapshot: Extract<EvryRunRecoveryResponse, { status: "active" }>
  ): void;
  fetchRecovery?: FetchRecovery;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): Promise<EvryRunRecoveryResponse> {
  const fetchRecovery = input.fetchRecovery ?? defaultFetchRecovery;
  const wait = input.wait ?? waitForRecovery;
  const deadline = performance.now() + MAX_OBSERVATION_MS;
  let resumeAttempts = 0;
  let unavailableReads = 0;
  let foundDurableRun = false;
  let lastSequence = -1;
  let lastSequencedSnapshot = "";
  const acceptSequence = (snapshot: EvryRunRecoveryResponse): boolean => {
    if (!("sequence" in snapshot)) return true;
    const serialized = JSON.stringify(snapshot);
    if (
      snapshot.sequence < lastSequence ||
      (snapshot.sequence === lastSequence &&
        lastSequencedSnapshot !== "" &&
        serialized !== lastSequencedSnapshot)
    ) {
      throw new Error("Evry recovery response moved backwards");
    }
    const changed = snapshot.sequence > lastSequence;
    lastSequence = snapshot.sequence;
    lastSequencedSnapshot = serialized;
    return changed;
  };
  while (!input.signal.aborted && performance.now() < deadline) {
    const snapshot = validateSnapshot(
      input.marker,
      await fetchRecovery(input.marker.requestId, "read", input.signal)
    );
    const changed = acceptSequence(snapshot);
    if (snapshot.status === "resumable") {
      foundDurableRun = true;
      if (resumeAttempts >= MAX_RESUME_ATTEMPTS) {
        throw new Error("Evry execution still requires durable reconciliation");
      }
      resumeAttempts += 1;
      const resumedSnapshot = validateSnapshot(
        input.marker,
        await fetchRecovery(input.marker.requestId, "resume", input.signal)
      );
      const resumedChanged = acceptSequence(resumedSnapshot);
      if (resumedSnapshot.status === "resumable") {
        await wait(500, input.signal);
        continue;
      }
      if (resumedSnapshot.status !== "active") return resumedSnapshot;
      if (resumedChanged) input.onActive(resumedSnapshot);
      await wait(500, input.signal);
      continue;
    }
    if (snapshot.status === "unavailable" && !foundDurableRun) {
      unavailableReads += 1;
      if (unavailableReads < PRECLAIM_GRACE_READS) {
        await wait(500, input.signal);
        continue;
      }
    }
    if (snapshot.status !== "active") return snapshot;
    foundDurableRun = true;
    if (changed) input.onActive(snapshot);
    await wait(500, input.signal);
  }
  if (input.signal.aborted) {
    throw new DOMException("Observation stopped", "AbortError");
  }
  return { status: "unavailable", requestId: input.marker.requestId };
}
