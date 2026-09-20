"use client";

import { memo, useLayoutEffect } from "react";
import { useEveAgent, type UseEveAgentHelpers } from "eve/react";
import type {
  ClientSessionState,
  EveMessageData,
  EveAgentStoreSnapshot,
  MessageStreamEvent,
} from "eve/client";
import { z } from "zod";

export const eveSessionMetadataSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EveSessionMetadata = z.infer<typeof eveSessionMetadataSchema>;
export type EveClient = UseEveAgentHelpers<EveMessageData>;
export type EveSnapshot = EveAgentStoreSnapshot<EveMessageData>;
export type EveSessionBinding = {
  key: string;
  metadata?: EveSessionMetadata;
  session?: ClientSessionState;
  events?: readonly MessageStreamEvent[];
};

export async function readEveSession(
  query: { conversationId: string } | { sessionId: string },
  signal?: AbortSignal
) {
  const response = await fetch(
    `/api/evry/eve/sessions?${new URLSearchParams(query)}`,
    { cache: "no-store", signal }
  );
  if (!response.ok)
    throw new Error("Unable to open this conversation. Try again.");
  return z
    .object({ session: eveSessionMetadataSchema })
    .parse(await response.json()).session;
}

/** The native store owns optimistic messages, durable replay, and reconnection. */
export const EveSessionBridge = memo(function EveSessionBridge({
  binding,
  onChange,
  onSession,
  onFinish,
  headers,
}: {
  binding: EveSessionBinding;
  onChange(client: EveClient): void;
  onSession(id: string): void;
  onFinish(snapshot: EveSnapshot): void;
  headers(): Record<string, string>;
}) {
  const client = useEveAgent({
    initialSession: binding.session,
    initialEvents: binding.events,
    optimistic: true,
    headers,
    resume: binding.session !== undefined,
    onSessionChange(session) {
      if (session) onSession(session.sessionId);
    },
    onFinish,
  });
  useLayoutEffect(() => onChange(client), [client, onChange]);
  return null;
});
