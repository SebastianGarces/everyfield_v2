import type {
  AssistantArtifactKind,
  AssistantArtifactStatus,
  AssistantMessageRole,
  AssistantThreadStatus,
} from "@/db/schema/assistant";

export type AssistantThreadSummary = {
  id: string;
  title: string;
  status: AssistantThreadStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

export type AssistantMessageRecord = {
  id: string;
  role: AssistantMessageRole;
  content: string;
  metadata: AssistantMessageMetadata | null;
  createdAt: string;
};

export type AssistantArtifactRecord = {
  id: string;
  kind: AssistantArtifactKind;
  status: AssistantArtifactStatus;
  payload: AssistantArtifactPayload;
  createdAt: string;
  updatedAt: string;
};

export type AssistantThreadDetail = {
  thread: AssistantThreadSummary;
  messages: AssistantMessageRecord[];
  artifacts: AssistantArtifactRecord[];
};

export type AssistantMessageAction = {
  label: string;
  href: string;
  target?: "_blank" | "_self";
};

export type AssistantMessageMetadata = {
  actions?: AssistantMessageAction[];
} & Record<string, unknown>;

export type AssistantArtifactPayload = Record<string, unknown>;
