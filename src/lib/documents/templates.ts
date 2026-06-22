// ============================================================================
// Document Templates — Catalog (F6)
// ============================================================================
//
// Code-defined catalog (the "role-templates" pattern). Phase-1 ships the three
// highest-value print-ready templates per gap-report P2-1. New templates are
// added here + a matching react-pdf component in ./pdf.
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
    format: "pdf",
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
    id: "guest-sign-in-sheet",
    name: "Guest Sign-in Sheet",
    description:
      "A letter-size sheet for capturing names, contact info, and who invited each guest at a vision meeting.",
    category: "vision_meeting",
    phase: 1,
    format: "pdf",
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
    format: "pdf",
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
];

export function getTemplateById(id: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((t) => t.id === id);
}
