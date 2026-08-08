// ============================================================================
// Document Templates — Catalog (F6)
// ============================================================================
//
// Code-defined catalog (the "role-templates" pattern) per gap-report P2-1.
// New templates are added here + a matching renderer: a react-pdf component in
// ./pdf (for "pdf") and/or a docx builder in ./docx (for "docx").
// ============================================================================

import type { DocumentTemplate } from "./types";

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "commitment-card",
    name: "Core Group Commitment Card",
    description:
      "A print-ready quarter-page card founding members sign to commit to GROW, PRAY, and GIVE through Launch Sunday.",
    category: "commitment",
    phase: 1,
    formats: ["pdf"],
    pageCount: 1,
    relatedWikiSlug: "frameworks/the-3-key-documents",
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
      {
        key: "pastor_name",
        label: "Pastor Name",
        required: false,
        autoFill: "pastor_name",
        placeholder: "Pastor John Smith",
      },
    ],
  },
  {
    id: "response-card",
    name: "Response Card",
    description:
      "A quarter-page card guests complete at a vision meeting to share contact info and how they'd like to be involved.",
    category: "vision_meeting",
    phase: 1,
    formats: ["pdf"],
    pageCount: 1,
    relatedWikiSlug: "vision-meetings/running-a-vision-meeting",
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
    ],
  },
  {
    id: "guest-sign-in-sheet",
    name: "Guest Sign-in Sheet",
    description:
      "A letter-size sheet for capturing names, contact info, and who invited each guest at a vision meeting.",
    category: "vision_meeting",
    phase: 1,
    formats: ["pdf"],
    pageCount: 1,
    relatedWikiSlug: "vision-meetings/running-a-vision-meeting",
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
      {
        key: "meeting_date",
        label: "Meeting Date",
        required: false,
        placeholder: "e.g. March 10, 2026",
        description: "Printed in the sheet header.",
      },
      {
        key: "meeting_number",
        label: "Meeting Number",
        required: false,
        placeholder: "e.g. 12",
      },
    ],
  },
  {
    id: "vision-meeting-agenda",
    name: "Vision Meeting Agenda",
    description:
      "A one-page agenda to keep a vision meeting on track — welcome, story, vision, GROW/PRAY/GIVE ask, and next steps.",
    category: "vision_meeting",
    phase: 1,
    formats: ["pdf", "docx"],
    pageCount: 1,
    relatedWikiSlug: "vision-meetings/running-a-vision-meeting",
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
      {
        key: "pastor_name",
        label: "Pastor Name",
        required: false,
        autoFill: "pastor_name",
        placeholder: "Pastor John Smith",
      },
      {
        key: "meeting_date",
        label: "Meeting Date",
        required: false,
        placeholder: "e.g. March 10, 2026",
      },
    ],
  },
  {
    id: "member-expectations",
    name: "Expectations of a Core Group Member",
    description:
      "An editable one-pager spelling out what's expected of a founding core-group member — presence, GROW/PRAY/GIVE, and team participation.",
    category: "commitment",
    phase: 1,
    formats: ["docx"],
    pageCount: 1,
    relatedWikiSlug: "frameworks/the-3-key-documents",
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
      {
        key: "pastor_name",
        label: "Pastor Name",
        required: false,
        autoFill: "pastor_name",
        placeholder: "Pastor John Smith",
      },
    ],
  },
  {
    id: "launch-team-commitment",
    name: "Launch Team Commitment",
    description:
      "An editable commitment letter launch-team members sign as the plant moves toward Launch Sunday.",
    category: "commitment",
    phase: 2,
    formats: ["docx"],
    pageCount: 1,
    relatedWikiSlug: "frameworks/the-3-key-documents",
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
      {
        key: "pastor_name",
        label: "Pastor Name",
        required: false,
        autoFill: "pastor_name",
        placeholder: "Pastor John Smith",
      },
    ],
  },
  {
    id: "follow-up-letter",
    name: "Vision Meeting Follow-up Letter",
    description:
      "An editable letter to send guests after a vision meeting — thank them, keep the connection warm, and invite the next step.",
    category: "vision_meeting",
    phase: 1,
    formats: ["docx"],
    pageCount: 1,
    relatedWikiSlug: "vision-meetings/running-a-vision-meeting",
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
      {
        key: "pastor_name",
        label: "Pastor Name",
        required: false,
        autoFill: "pastor_name",
        placeholder: "Pastor John Smith",
      },
    ],
  },
  {
    id: "board-meeting-agenda",
    name: "Board / Elder Meeting Agenda",
    description:
      "An editable agenda for a board or elder meeting — prayer, minutes, financials, ministry updates, and action items.",
    category: "administrative",
    formats: ["docx"],
    pageCount: 1,
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
      {
        key: "meeting_date",
        label: "Meeting Date",
        required: false,
        placeholder: "e.g. March 10, 2026",
      },
    ],
  },
  {
    id: "first-year-budget",
    name: "First-Year Budget",
    description:
      "A 12-month budget spreadsheet with income/expense categories and live total formulas.",
    category: "administrative",
    formats: ["xlsx"],
    pageCount: 1,
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
    ],
  },
  {
    id: "budget-worksheet",
    name: "Budget Worksheet",
    description:
      "A simple monthly-vs-annual budget planner spreadsheet with live total formulas.",
    category: "administrative",
    formats: ["xlsx"],
    pageCount: 1,
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
    ],
  },
  {
    id: "launch-sunday-checklists",
    name: "Launch Sunday Checklists",
    description:
      "A print-ready packet with a per-team launch-day checklist — setup, hospitality, worship, kids, connections, and prayer.",
    category: "operational",
    phase: 4,
    formats: ["pdf"],
    pageCount: 6,
    mergeFields: [
      {
        key: "church_name",
        label: "Church Name",
        required: true,
        autoFill: "church_name",
      },
      {
        // The token name, not a column name: the day is resolved from the
        // launch entity (LS-001) — `churches.launch_date` no longer exists.
        key: "launch_date",
        label: "Launch Date",
        required: false,
        autoFill: "launch_date",
        placeholder: "e.g. September 14, 2026",
      },
    ],
  },
];

export function getTemplateById(id: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((t) => t.id === id);
}
