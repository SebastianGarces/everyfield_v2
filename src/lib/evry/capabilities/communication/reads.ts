import { z } from "zod";

import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { createEvryReadContinuation } from "@/lib/evry/reads/core";
import {
  getChurchDeliveryTotals,
  getCommunication,
  getCommunicationRecipients,
  getCommunications,
  getMeetingCommunications,
  getMeetingTrackingByPerson,
  getPersonCommunications,
  resolveSubjects,
} from "@/lib/communication/service";
import {
  getGroupRecipients,
  listRecipientTeams,
} from "@/lib/communication/recipient-groups";
import { getNonOpenerSummary } from "@/lib/communication/send";
import { getTemplate, getTemplates } from "@/lib/communication/templates";
import { listPeople } from "@/lib/people/service";

export const COMMUNICATION_READ_IDENTITIES = {
  compose: "communication.compose.get-context",
  totals: "communication.delivery.get-church-totals",
  meetingTracking: "communication.delivery.get-meeting-tracking",
  message: "communication.delivery.get-message",
  messageRecipients: "communication.delivery.get-message-recipients",
  meetingHistory: "communication.history.get-meeting",
  personHistory: "communication.history.get-person",
  history: "communication.history.list",
  teams: "communication.recipients.list-teams",
  group: "communication.recipients.resolve-group",
  people: "communication.recipients.search-people",
  resendSummary: "communication.resends.get-eligible-non-openers",
  template: "communication.templates.get",
  templates: "communication.templates.list",
} as const;

const noInput = {};
const idInput = { id: z.string().uuid() };
const queryInput = { query: z.string().trim().min(1).max(160) };
const groupInput = { group: z.string().trim().min(1).max(200) };

function link(label: string, href: string) {
  return trustedEvryApplicationSourceLink({ label, href });
}

function display(value: string | null | undefined, fallback = "Not set") {
  return value?.trim() || fallback;
}

export const COMMUNICATION_HISTORY_READ = defineEvryReadRegistration({
  id: "communication.history",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.history,
  inputShape: { search: z.string().trim().max(160) },
  async run({ authorization }, input) {
    const result = await getCommunications(authorization.actor.plantId, {
      limit: 24,
      search: input.search || undefined,
    });
    const subjects = await resolveSubjects(
      authorization.actor.plantId,
      result.communications
    );
    const hidden = Math.max(0, result.total - result.communications.length);
    return buildEvryReadArtifact({
      title: input.search
        ? `Communication matching “${input.search}”`
        : "Communication history",
      filters: input.search
        ? [{ label: "Search", value: input.search }]
        : [{ label: "Plant", value: "Current plant" }],
      exclusions:
        hidden > 0
          ? [{ reason: "Not shown on this result page", count: hidden }]
          : [],
      items: result.communications.map((message) => ({
        id: message.id,
        label:
          subjects.get(message.id) ?? display(message.subject, "(No subject)"),
        facts: [
          { label: "Status", value: message.status },
          {
            label: "Recipients",
            value: String(message.recipientCount ?? 0),
          },
          { label: "Created", value: message.createdAt.toISOString() },
        ],
        sourceLink: link(
          `Open ${display(message.subject, "message")}`,
          `/communication/${message.id}`
        ),
      })),
      sourceLinks: [
        link("Open communication history", "/communication/history"),
      ],
    });
  },
});

export const COMMUNICATION_MESSAGE_READ = defineEvryReadRegistration({
  id: "communication.message",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.message,
  inputShape: idInput,
  async run({ authorization }, { id }) {
    const message = await getCommunication(authorization.actor.plantId, id);
    return buildEvryReadArtifact({
      title: message
        ? display(message.subject, "Message")
        : "Message not found",
      filters: [{ label: "Message", value: id }],
      exclusions: message
        ? []
        : [{ reason: "Unavailable in this plant", count: 1 }],
      items: message
        ? [
            {
              id: message.id,
              label: display(message.subject, "(No subject)"),
              facts: [
                { label: "Status", value: message.status },
                { label: "Recipients", value: String(message.stats.total) },
                { label: "Delivered", value: String(message.stats.delivered) },
                { label: "Opened", value: String(message.stats.opened) },
                { label: "Failed", value: String(message.stats.failed) },
              ],
              sourceLink: link("Open message", `/communication/${message.id}`),
            },
          ]
        : [],
      sourceLinks: [link("Open communication", "/communication")],
    });
  },
});

export const COMMUNICATION_MESSAGE_RECIPIENTS_READ = defineEvryReadRegistration(
  {
    id: "communication.message-recipients",
    capabilityIdentity: COMMUNICATION_READ_IDENTITIES.messageRecipients,
    inputShape: idInput,
    async run({ authorization }, { id }) {
      const recipients = await getCommunicationRecipients(
        authorization.actor.plantId,
        id
      );
      return buildEvryReadArtifact({
        title: "Message recipients",
        filters: [{ label: "Message", value: id }],
        exclusions: [],
        items: recipients.map((recipient) => ({
          id: recipient.id,
          label:
            [recipient.person.firstName, recipient.person.lastName]
              .filter(Boolean)
              .join(" ") || "Recipient",
          facts: [
            { label: "Email", value: display(recipient.email) },
            { label: "Status", value: recipient.status },
          ],
          sourceLink: link(
            "Open recipient",
            `/people/${recipient.personId}/communication`
          ),
        })),
        sourceLinks: [link("Open message", `/communication/${id}`)],
      });
    },
  }
);

export const COMMUNICATION_TOTALS_READ = defineEvryReadRegistration({
  id: "communication.delivery-totals",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.totals,
  inputShape: noInput,
  async run({ authorization }) {
    const totals = await getChurchDeliveryTotals(authorization.actor.plantId);
    return buildEvryReadArtifact({
      title: "Communication delivery totals",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [],
      items: [
        {
          id: "delivery-totals",
          label: "Delivery outcomes",
          facts: Object.entries(totals).map(([label, value]) => ({
            label,
            value: String(value),
          })),
          sourceLink: link("Open Communication Hub", "/communication"),
        },
      ],
      sourceLinks: [link("Open Communication Hub", "/communication")],
    });
  },
});

export const COMMUNICATION_PERSON_HISTORY_READ = defineEvryReadRegistration({
  id: "communication.person-history",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.personHistory,
  inputShape: { personId: z.string().uuid() },
  async run({ authorization }, { personId }) {
    const rows = await getPersonCommunications(
      authorization.actor.plantId,
      personId
    );
    return buildEvryReadArtifact({
      title: "Communication for this person",
      filters: [{ label: "Person", value: personId }],
      exclusions: [],
      items: rows.map(({ communication, recipient }) => ({
        id: recipient.id,
        label: display(communication.subject, "(No subject)"),
        facts: [
          { label: "Status", value: recipient.status },
          { label: "Created", value: communication.createdAt.toISOString() },
        ],
        sourceLink: link("Open message", `/communication/${communication.id}`),
      })),
      sourceLinks: [
        link("Open person communication", `/people/${personId}/communication`),
      ],
    });
  },
});

export const COMMUNICATION_MEETING_HISTORY_READ = defineEvryReadRegistration({
  id: "communication.meeting-history",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.meetingHistory,
  inputShape: { meetingId: z.string().uuid() },
  async run({ authorization }, { meetingId }) {
    const rows = await getMeetingCommunications(
      authorization.actor.plantId,
      meetingId
    );
    return buildEvryReadArtifact({
      title: "Communication for this meeting",
      filters: [{ label: "Meeting", value: meetingId }],
      exclusions: [],
      items: rows.map((message) => ({
        id: message.id,
        label: display(message.subject, "(No subject)"),
        facts: [
          { label: "Status", value: message.status },
          { label: "Recipients", value: String(message.stats.total) },
          { label: "Opened", value: String(message.stats.opened) },
        ],
        sourceLink: link("Open message", `/communication/${message.id}`),
      })),
      sourceLinks: [link("Open meeting", `/meetings/${meetingId}`)],
    });
  },
});

export const COMMUNICATION_MEETING_TRACKING_READ = defineEvryReadRegistration({
  id: "communication.meeting-tracking",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.meetingTracking,
  inputShape: { meetingId: z.string().uuid() },
  async run({ authorization }, { meetingId }) {
    const rows = await getMeetingTrackingByPerson(
      authorization.actor.plantId,
      meetingId
    );
    return buildEvryReadArtifact({
      title: "Meeting delivery tracking",
      filters: [{ label: "Meeting", value: meetingId }],
      exclusions: [],
      items: [...rows.entries()].map(([personId, outcome]) => ({
        id: personId,
        label: personId,
        facts: [
          { label: "Status", value: outcome.status },
          {
            label: "Delivered",
            value: outcome.deliveredAt?.toISOString() ?? "Not recorded",
          },
          {
            label: "Opened",
            value: outcome.openedAt?.toISOString() ?? "Not recorded",
          },
        ],
        sourceLink: link("Open person", `/people/${personId}`),
      })),
      sourceLinks: [
        link("Open meeting invitations", `/meetings/${meetingId}/invitations`),
      ],
    });
  },
});

function peopleArtifact(input: {
  title: string;
  filterLabel: string;
  filterValue: string;
  people: readonly {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
  }[];
}) {
  const reachable = input.people.filter((person) => person.email);
  return buildEvryReadArtifact({
    title: input.title,
    filters: [{ label: input.filterLabel, value: input.filterValue }],
    exclusions:
      reachable.length === input.people.length
        ? []
        : [
            {
              reason: "Missing email address",
              count: input.people.length - reachable.length,
            },
          ],
    items: reachable.map((person) => ({
      id: person.id,
      label:
        [person.firstName, person.lastName].filter(Boolean).join(" ") ||
        "Person",
      facts: [{ label: "Email", value: person.email ?? "Not set" }],
      sourceLink: link("Open person", `/people/${person.id}`),
    })),
    sourceLinks: [link("Open compose", "/communication/compose")],
  });
}

export const COMMUNICATION_RECIPIENT_GROUP_READ = defineEvryReadRegistration({
  id: "communication.recipient-group",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.group,
  inputShape: groupInput,
  async run({ authorization }, { group }) {
    const people = await getGroupRecipients(authorization.actor.plantId, group);
    return peopleArtifact({
      title: "Resolved recipient group",
      filterLabel: "Group",
      filterValue: group,
      people,
    });
  },
});

export const COMMUNICATION_RECIPIENT_SEARCH_READ = defineEvryReadRegistration({
  id: "communication.recipient-search",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.people,
  inputShape: queryInput,
  async run({ authorization }, { query }) {
    const result = await listPeople(authorization.actor.plantId, {
      search: query,
      limit: 20,
    });
    return peopleArtifact({
      title: `Recipients matching “${query}”`,
      filterLabel: "Search",
      filterValue: query,
      people: result.people,
    });
  },
});

export const COMMUNICATION_TEAMS_READ = defineEvryReadRegistration({
  id: "communication.recipient-teams",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.teams,
  inputShape: noInput,
  async run({ authorization }) {
    const teams = await listRecipientTeams(authorization.actor.plantId);
    return buildEvryReadArtifact({
      title: "Recipient teams",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [],
      items: teams.map((team) => ({
        id: team.id,
        label: team.name,
        facts: [
          { label: "Selector", value: team.selector },
          { label: "Active members", value: String(team.memberCount) },
        ],
        sourceLink: link("Open team", `/teams/${team.id}`),
      })),
      sourceLinks: [link("Open compose", "/communication/compose")],
    });
  },
});

export const COMMUNICATION_RESEND_SUMMARY_READ = defineEvryReadRegistration({
  id: "communication.resend-summary",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.resendSummary,
  inputShape: idInput,
  async run({ authorization }, { id }) {
    const summary = await getNonOpenerSummary(authorization.actor.plantId, id);
    return buildEvryReadArtifact({
      title: "Resend eligibility",
      filters: [{ label: "Original message", value: id }],
      exclusions: [
        { reason: "Already opened", count: summary.opened },
        {
          reason: "Not eligible for resend",
          count: Math.max(
            0,
            summary.total - summary.opened - summary.personIds.length
          ),
        },
      ].filter(({ count }) => count > 0),
      items: summary.personIds.map((personId) => ({
        id: personId,
        label: personId,
        facts: [{ label: "Eligibility", value: "No open recorded" }],
        sourceLink: link("Open person", `/people/${personId}`),
      })),
      sourceLinks: [link("Open original message", `/communication/${id}`)],
    });
  },
});

function templateItem(
  template: Awaited<ReturnType<typeof getTemplates>>[number]
) {
  return {
    id: template.id,
    label: template.name,
    facts: [
      { label: "Category", value: template.category },
      { label: "Channel", value: template.channel },
      { label: "Subject", value: display(template.subject) },
      { label: "Scope", value: template.isSystem ? "System" : "Current plant" },
    ],
    sourceLink: link(
      "Open template",
      `/communication/templates/${template.id}/edit`
    ),
  };
}

export const COMMUNICATION_TEMPLATES_READ = defineEvryReadRegistration({
  id: "communication.templates",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.templates,
  inputShape: noInput,
  async run({ authorization }) {
    const templates = await getTemplates(authorization.actor.plantId);
    return buildEvryReadArtifact({
      title: "Communication templates",
      filters: [{ label: "Plant", value: "Current plant plus system" }],
      exclusions: [],
      items: templates.map(templateItem),
      sourceLinks: [link("Open templates", "/communication/templates")],
    });
  },
});

export const COMMUNICATION_TEMPLATE_READ = defineEvryReadRegistration({
  id: "communication.template",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.template,
  inputShape: idInput,
  async run({ authorization }, { id }) {
    const template = await getTemplate(id, authorization.actor.plantId);
    return buildEvryReadArtifact({
      title: template?.name ?? "Template not found",
      filters: [{ label: "Template", value: id }],
      exclusions: template
        ? []
        : [{ reason: "Unavailable in this plant", count: 1 }],
      items: template ? [templateItem(template)] : [],
      sourceLinks: [link("Open templates", "/communication/templates")],
    });
  },
});

export const COMMUNICATION_COMPOSE_READ = defineEvryReadRegistration({
  id: "communication.compose-context",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.compose,
  inputShape: noInput,
  async run({ authorization }) {
    const [templates, teams] = await Promise.all([
      getTemplates(authorization.actor.plantId),
      listRecipientTeams(authorization.actor.plantId),
    ]);
    return buildEvryReadArtifact({
      title: "Communication compose context",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [],
      items: [
        ...templates.map((template) => ({
          ...templateItem(template),
          id: `template:${template.id}`,
        })),
        ...teams.map((team) => ({
          id: `team:${team.id}`,
          label: team.name,
          facts: [
            { label: "Kind", value: "Recipient team" },
            { label: "Active members", value: String(team.memberCount) },
          ],
          sourceLink: link("Open team", `/teams/${team.id}`),
        })),
      ],
      sourceLinks: [link("Open compose", "/communication/compose")],
    });
  },
});

export type CommunicationEvryReadSelection =
  | Readonly<{ kind: "history"; search: string }>
  | Readonly<{ kind: "message"; id: string }>
  | Readonly<{ kind: "message_recipients"; id: string }>
  | Readonly<{ kind: "totals" }>
  | Readonly<{ kind: "person_history" }>
  | Readonly<{ kind: "meeting_history" }>
  | Readonly<{ kind: "meeting_tracking" }>
  | Readonly<{ kind: "teams" }>
  | Readonly<{ kind: "group"; group: string }>
  | Readonly<{ kind: "people"; query: string }>
  | Readonly<{ kind: "resend_summary"; id: string }>
  | Readonly<{ kind: "templates" }>
  | Readonly<{ kind: "template"; id: string }>
  | Readonly<{ kind: "compose" }>;

const UUID =
  "([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";

export function selectCommunicationEvryRead(
  literalUserText: string
): CommunicationEvryReadSelection | null {
  const text = literalUserText.normalize("NFKC").trim();
  let match: RegExpExecArray | null;
  if (/^(?:show|list) communication history[.!?]*$/i.test(text)) {
    return { kind: "history", search: "" };
  }
  match = /^find communication matching\s+(.+?)[.!?]*$/i.exec(text);
  if (match?.[1]) return { kind: "history", search: match[1].trim() };
  match = new RegExp(`^show message\\s+${UUID}[.!?]*$`, "i").exec(text);
  if (match?.[1]) return { kind: "message", id: match[1] };
  match = new RegExp(
    `^show recipients for message\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1]) return { kind: "message_recipients", id: match[1] };
  if (/^show (?:communication )?delivery totals[.!?]*$/i.test(text)) {
    return { kind: "totals" };
  }
  if (/^show communication for this person[.!?]*$/i.test(text)) {
    return { kind: "person_history" };
  }
  if (/^show communication for this meeting[.!?]*$/i.test(text)) {
    return { kind: "meeting_history" };
  }
  if (/^show meeting delivery tracking[.!?]*$/i.test(text)) {
    return { kind: "meeting_tracking" };
  }
  if (/^(?:show|list) recipient teams[.!?]*$/i.test(text))
    return { kind: "teams" };
  match = /^resolve recipient group\s+(.+?)[.!?]*$/i.exec(text);
  if (match?.[1]) return { kind: "group", group: match[1].trim() };
  match = /^search communication recipients\s+(.+?)[.!?]*$/i.exec(text);
  if (match?.[1]) return { kind: "people", query: match[1].trim() };
  match = new RegExp(
    `^show resend eligibility for message\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1]) return { kind: "resend_summary", id: match[1] };
  if (/^(?:show|list) communication templates[.!?]*$/i.test(text)) {
    return { kind: "templates" };
  }
  match = new RegExp(`^show template\\s+${UUID}[.!?]*$`, "i").exec(text);
  if (match?.[1]) return { kind: "template", id: match[1] };
  return /^show compose context[.!?]*$/i.test(text)
    ? { kind: "compose" }
    : null;
}

export const COMMUNICATION_EVRY_READ_REGISTRATIONS = [
  COMMUNICATION_HISTORY_READ,
  COMMUNICATION_MESSAGE_READ,
  COMMUNICATION_MESSAGE_RECIPIENTS_READ,
  COMMUNICATION_TOTALS_READ,
  COMMUNICATION_PERSON_HISTORY_READ,
  COMMUNICATION_MEETING_HISTORY_READ,
  COMMUNICATION_MEETING_TRACKING_READ,
  COMMUNICATION_RECIPIENT_GROUP_READ,
  COMMUNICATION_RECIPIENT_SEARCH_READ,
  COMMUNICATION_TEAMS_READ,
  COMMUNICATION_RESEND_SUMMARY_READ,
  COMMUNICATION_TEMPLATES_READ,
  COMMUNICATION_TEMPLATE_READ,
  COMMUNICATION_COMPOSE_READ,
] as const;

export const continueCommunicationEvryRead = createEvryReadContinuation({
  registrations: COMMUNICATION_EVRY_READ_REGISTRATIONS,
  async select({ literalUserText, pageContext, eligibleReadIds }) {
    const selection = selectCommunicationEvryRead(literalUserText);
    if (!selection) return null;
    const selected = (() => {
      switch (selection.kind) {
        case "history":
          return {
            readId: COMMUNICATION_HISTORY_READ.id,
            input: { search: selection.search },
          };
        case "message":
          return {
            readId: COMMUNICATION_MESSAGE_READ.id,
            input: { id: selection.id },
          };
        case "message_recipients":
          return {
            readId: COMMUNICATION_MESSAGE_RECIPIENTS_READ.id,
            input: { id: selection.id },
          };
        case "totals":
          return { readId: COMMUNICATION_TOTALS_READ.id, input: {} };
        case "person_history":
          return pageContext?.kind === "person"
            ? {
                readId: COMMUNICATION_PERSON_HISTORY_READ.id,
                input: { personId: pageContext.recordId },
              }
            : null;
        case "meeting_history":
          return pageContext?.kind === "meeting"
            ? {
                readId: COMMUNICATION_MEETING_HISTORY_READ.id,
                input: { meetingId: pageContext.recordId },
              }
            : null;
        case "meeting_tracking":
          return pageContext?.kind === "meeting"
            ? {
                readId: COMMUNICATION_MEETING_TRACKING_READ.id,
                input: { meetingId: pageContext.recordId },
              }
            : null;
        case "teams":
          return { readId: COMMUNICATION_TEAMS_READ.id, input: {} };
        case "group":
          return {
            readId: COMMUNICATION_RECIPIENT_GROUP_READ.id,
            input: { group: selection.group },
          };
        case "people":
          return {
            readId: COMMUNICATION_RECIPIENT_SEARCH_READ.id,
            input: { query: selection.query },
          };
        case "resend_summary":
          return {
            readId: COMMUNICATION_RESEND_SUMMARY_READ.id,
            input: { id: selection.id },
          };
        case "templates":
          return { readId: COMMUNICATION_TEMPLATES_READ.id, input: {} };
        case "template":
          return {
            readId: COMMUNICATION_TEMPLATE_READ.id,
            input: { id: selection.id },
          };
        case "compose":
          return { readId: COMMUNICATION_COMPOSE_READ.id, input: {} };
      }
    })();
    return selected && eligibleReadIds.includes(selected.readId)
      ? selected
      : null;
  },
});
