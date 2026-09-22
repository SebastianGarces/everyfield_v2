import type { DocumentMergeValues, DocumentTemplate } from "../types";

export const ORIENTATION_AGENDA_TEMPLATE: DocumentTemplate = {
  id: "orientation-agenda",
  name: "Orientation Agenda",
  description:
    "An orientation handout with the meeting details and an agenda you can review and edit.",
  category: "operational",
  formats: ["pdf", "docx"],
  pageCount: 1,
  mergeFields: [
    {
      key: "church_name",
      label: "Church name",
      required: true,
      autoFill: "church_name",
    },
    { key: "meeting_title", label: "Meeting title", required: true },
    {
      key: "meeting_date",
      label: "Date and time",
      required: true,
      description: "Use the orientation's date, start time, and time zone.",
    },
    {
      key: "meeting_location",
      label: "Location",
      required: false,
      description:
        "Use the meeting's location, including its address if available.",
    },
    { key: "meeting_duration", label: "Duration", required: false },
    {
      key: "meeting_agenda",
      label: "Agenda",
      required: true,
      description:
        "Use the saved orientation agenda, or review a proposed agenda before generating. Put each item on its own line.",
    },
  ],
};

/** Only reviewed merge values: no invented meeting facts or default schedule. */
export function orientationAgendaContent(values: DocumentMergeValues) {
  return {
    title: "Orientation Agenda",
    meetingTitle: values.meeting_title ?? "",
    details: [
      { label: "Date and time", value: values.meeting_date ?? "" },
      { label: "Location", value: values.meeting_location ?? "" },
      { label: "Duration", value: values.meeting_duration ?? "" },
    ].filter((detail) => detail.value.trim()),
    agendaLines: (values.meeting_agenda ?? "").split(/\r?\n/),
  };
}
