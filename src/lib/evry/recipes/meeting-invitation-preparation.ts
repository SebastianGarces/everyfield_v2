import { defineEvryModelPreparation } from "@/lib/evry/capabilities/model-preparation";
import { createMeetingInvitationConversationContinuation } from "./meeting-invitation-conversation";
import {
  meetingInvitationRequestSchema,
  MEETING_INVITATION_CAPABILITY_IDENTITY,
  MEETING_INVITATION_ADD_GUESTS_IDENTITY,
  MEETING_INVITATION_SEND_IDENTITY,
} from "./meeting-invitation";

/** The model supplies intent, never the compiled three-step plan or approval. */
export const MEETING_INVITATION_MODEL_PREPARATION = defineEvryModelPreparation({
  id: "recipe.meeting-invite",
  capabilityIdentities: [
    MEETING_INVITATION_CAPABILITY_IDENTITY,
    MEETING_INVITATION_ADD_GUESTS_IDENTITY,
    MEETING_INVITATION_SEND_IDENTITY,
  ],
  inputSchema: meetingInvitationRequestSchema.describe(
    "Prepare one Vision Meeting, add guests and send one invitation template after exact confirmation. sourceText is the user's date/time wording, resolved in the plant timezone. Specify guestPersonIds for an explicit audience; omitted means core team plus prospects without prior Vision Meeting attendance. A broad request without audience intent needs clarification."
  ),
  run(selection, request) {
    return createMeetingInvitationConversationContinuation(
      undefined,
      () => request
    ).continue(selection);
  },
});
