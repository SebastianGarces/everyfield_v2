// ============================================================================
// Vision Meeting Agenda — shared content (F6)
// ============================================================================
//
// The agenda's WORDING, independent of output format. One template renders in
// two formats (./pdf and ./docx); both renderers import this and keep their
// own layout code, so an edit here ships in both documents — the PDF and the
// DOCX can differ only in how they draw it. Plain data: no renderer imports.
// ============================================================================

export const VISION_MEETING_AGENDA: readonly {
  title: string;
  detail: string;
}[] = [
  {
    title: "Welcome & Connection",
    detail: "Greet guests, brief introductions, set a warm tone.",
  },
  {
    title: "Our Story",
    detail: "Why this church, why now — the planter's calling.",
  },
  {
    title: "The Vision",
    detail: "Who we're reaching, what kind of church we're becoming.",
  },
  {
    title: "GROW · PRAY · GIVE",
    detail: "The invitation to join the core group and how to take part.",
  },
  {
    title: "Next Steps",
    detail: "Commitment cards, upcoming dates, and how to stay connected.",
  },
  {
    title: "Prayer & Close",
    detail: "Pray over the mission and the people in the room.",
  },
];

const VISION_MEETING_CLOSING_FALLBACK =
  "Keep it to 45–60 minutes. End on time and on vision.";

/** The closing line — the leader's name when known, the timekeeping nudge otherwise. */
export const visionMeetingClosing = (pastorName?: string): string =>
  pastorName ? `Led by ${pastorName}` : VISION_MEETING_CLOSING_FALLBACK;
