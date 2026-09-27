import {
  communicationChannels,
  communicationStatuses,
  type CommunicationChannel,
  type CommunicationStatus,
} from "@/db/schema/communication";
import { COMMUNICATION_STATUS_LABELS } from "./status-display";

export interface HistoryFilterAvailability {
  channels: CommunicationChannel[];
  statuses: CommunicationStatus[];
}
const channelLabels: Record<CommunicationChannel, string> = {
  email: "Email",
  sms: "SMS",
  both: "Email + SMS",
};
const supportedStatuses: readonly CommunicationStatus[] = [
  "sending",
  "sent",
  "failed",
  "logged",
];

/** Historical records and valid bookmarks remain reachable without advertising deferred delivery. */
export function historyFilterOptions(
  available: HistoryFilterAvailability,
  selected: { channel?: CommunicationChannel; status?: CommunicationStatus }
) {
  return {
    channels: communicationChannels
      .filter(
        (value) =>
          value === "email" ||
          available.channels.includes(value) ||
          selected.channel === value
      )
      .map((value) => ({
        value,
        label:
          channelLabels[value] + (value === "email" ? "" : " (historical)"),
        historical: value !== "email",
      })),
    statuses: communicationStatuses
      .filter(
        (value) =>
          supportedStatuses.includes(value) ||
          available.statuses.includes(value) ||
          selected.status === value
      )
      .map((value) => ({
        value,
        label:
          COMMUNICATION_STATUS_LABELS[value] +
          (supportedStatuses.includes(value) ? "" : " (historical)"),
        historical: !supportedStatuses.includes(value),
      })),
  };
}
