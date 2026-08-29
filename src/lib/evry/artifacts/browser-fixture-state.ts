import { z } from "zod";

import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";

import { INITIAL_MEETING_CONFIRMATION } from "./fixtures";
import {
  evryDetailedConfirmationArtifactDocumentSchema,
  evryDetailedProgressArtifactDocumentSchema,
  evryDetailedReceiptArtifactDocumentSchema,
} from "./review";

export const EVRY_ARTIFACT_BROWSER_FIXTURE_STORAGE_KEY =
  "evry:typed-artifact-browser-fixture:v1";

const interactionStateSchema = z.discriminatedUnion("status", [
  z
    .strictObject({
      status: z.literal("review"),
      confirmation: evryDetailedConfirmationArtifactDocumentSchema,
    })
    .readonly(),
  z
    .strictObject({
      status: z.literal("editing"),
      invalidatedPlan: evryConversationPlanIdentitySchema,
    })
    .readonly(),
  z
    .strictObject({
      status: z.literal("cancelled"),
      plan: evryConversationPlanIdentitySchema,
    })
    .readonly(),
  z
    .strictObject({
      status: z.literal("executing"),
      progress: evryDetailedProgressArtifactDocumentSchema,
    })
    .readonly(),
  z
    .strictObject({
      status: z.literal("receipt"),
      receipt: evryDetailedReceiptArtifactDocumentSchema,
    })
    .readonly(),
]);

const snapshotSchema = z
  .strictObject({
    snapshotVersion: z.literal(1),
    state: interactionStateSchema,
    recipient: z.string().max(500),
    notice: z.string().trim().min(1).max(500),
    acceptedExecutions: z.number().int().min(0).max(1),
    completionDueAt: z.number().int().nonnegative().nullable(),
  })
  .superRefine((snapshot, context) => {
    if (
      (snapshot.state.status === "executing") !==
      (snapshot.completionDueAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completionDueAt"],
        message: "Only an executing fixture may carry a completion deadline",
      });
    }
    const hasAcceptedExecution =
      snapshot.state.status === "executing" ||
      snapshot.state.status === "receipt";
    if ((snapshot.acceptedExecutions === 1) !== hasAcceptedExecution) {
      context.addIssue({
        code: "custom",
        path: ["acceptedExecutions"],
        message: "The execution count must agree with the fixture lifecycle",
      });
    }
  })
  .readonly();

export type EvryArtifactBrowserFixtureSnapshot = z.infer<typeof snapshotSchema>;

export type EvryArtifactBrowserFixtureStorage = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}>;

export type EvryArtifactBrowserFixtureStore = Readonly<{
  subscribe(listener: () => void): () => void;
  getSnapshot(): EvryArtifactBrowserFixtureSnapshot;
  getServerSnapshot(): null;
  replace(snapshot: EvryArtifactBrowserFixtureSnapshot): void;
  reset(): void;
}>;

export const INITIAL_BROWSER_FIXTURE_RECIPIENT =
  "Taylor Brooks · taylor@example.test";

export function initialEvryArtifactBrowserFixtureSnapshot(): EvryArtifactBrowserFixtureSnapshot {
  return snapshotSchema.parse({
    snapshotVersion: 1,
    state: {
      status: "review",
      confirmation: INITIAL_MEETING_CONFIRMATION,
    },
    recipient: INITIAL_BROWSER_FIXTURE_RECIPIENT,
    notice: "Review the exact plan, then edit one recipient.",
    acceptedExecutions: 0,
    completionDueAt: null,
  });
}

export function parseEvryArtifactBrowserFixtureSnapshot(
  input: unknown
): EvryArtifactBrowserFixtureSnapshot {
  return snapshotSchema.parse(input);
}

export function persistEvryArtifactBrowserFixtureSnapshot(
  storage: EvryArtifactBrowserFixtureStorage,
  snapshot: EvryArtifactBrowserFixtureSnapshot
): void {
  storage.setItem(
    EVRY_ARTIFACT_BROWSER_FIXTURE_STORAGE_KEY,
    JSON.stringify(snapshotSchema.parse(snapshot))
  );
}

export function restoreEvryArtifactBrowserFixtureSnapshot(
  storage: EvryArtifactBrowserFixtureStorage
): EvryArtifactBrowserFixtureSnapshot {
  const stored = storage.getItem(EVRY_ARTIFACT_BROWSER_FIXTURE_STORAGE_KEY);
  if (stored === null) return initialEvryArtifactBrowserFixtureSnapshot();
  try {
    return snapshotSchema.parse(JSON.parse(stored));
  } catch {
    storage.removeItem(EVRY_ARTIFACT_BROWSER_FIXTURE_STORAGE_KEY);
    return initialEvryArtifactBrowserFixtureSnapshot();
  }
}

export function resetEvryArtifactBrowserFixtureSnapshot(
  storage: EvryArtifactBrowserFixtureStorage
): EvryArtifactBrowserFixtureSnapshot {
  storage.removeItem(EVRY_ARTIFACT_BROWSER_FIXTURE_STORAGE_KEY);
  return initialEvryArtifactBrowserFixtureSnapshot();
}

export function createEvryArtifactBrowserFixtureStore(
  storage: EvryArtifactBrowserFixtureStorage
): EvryArtifactBrowserFixtureStore {
  let current: EvryArtifactBrowserFixtureSnapshot | null = null;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  return Object.freeze({
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      current ??= restoreEvryArtifactBrowserFixtureSnapshot(storage);
      return current;
    },
    getServerSnapshot() {
      return null;
    },
    replace(snapshot) {
      current = parseEvryArtifactBrowserFixtureSnapshot(snapshot);
      persistEvryArtifactBrowserFixtureSnapshot(storage, current);
      publish();
    },
    reset() {
      current = resetEvryArtifactBrowserFixtureSnapshot(storage);
      publish();
    },
  });
}
