// ============================================================================
// Document Templates — Shared PDF styles (F6)
// ============================================================================
//
// The faces come from `./fonts.ts` and are never spelled out here. They used to
// be the standard-14 names, which carry WinAnsi encoding only — so any
// character a user typed outside WinAnsi (an arrow, a check mark, a
// box-drawing rule pasted into a field) reached the file as the WRONG GLYPH.
// See the header of `./fonts.ts` for the whole story (#398).
// ============================================================================

import { StyleSheet } from "@react-pdf/renderer";

import { PDF_FONT } from "./fonts";

/** Page sizes in points (72pt = 1in). */
export const PAGE_SIZE = {
  /** 5.5" x 4.25" quarter-page card. */
  card: [396, 306] as [number, number],
};

export const colors = {
  ink: "#111827",
  muted: "#6b7280",
  line: "#d1d5db",
  faint: "#f3f4f6",
};

export const styles = StyleSheet.create({
  page: {
    paddingVertical: 48,
    paddingHorizontal: 48,
    fontSize: 11,
    lineHeight: 1.5,
    color: colors.ink,
    fontFamily: PDF_FONT.body,
  },
  cardPage: {
    padding: 22,
    fontSize: 9,
    lineHeight: 1.4,
    color: colors.ink,
    fontFamily: PDF_FONT.body,
  },
  h1: {
    fontSize: 20,
    fontFamily: PDF_FONT.bold,
    marginBottom: 4,
  },
  h2: {
    fontSize: 13,
    fontFamily: PDF_FONT.bold,
    marginBottom: 6,
    marginTop: 14,
  },
  subtitle: {
    fontSize: 11,
    color: colors.muted,
    marginBottom: 16,
  },
  centerHeading: {
    fontSize: 13,
    fontFamily: PDF_FONT.bold,
    textAlign: "center",
    letterSpacing: 1,
  },
  centerChurch: {
    fontSize: 11,
    fontFamily: PDF_FONT.bold,
    textAlign: "center",
    marginBottom: 10,
  },
  paragraph: {
    marginBottom: 8,
  },
  checkRow: {
    flexDirection: "row",
    marginBottom: 5,
  },
  checkbox: {
    width: 11,
    height: 11,
    borderWidth: 1,
    borderColor: colors.ink,
    marginRight: 7,
    marginTop: 1,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    marginVertical: 12,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
    flexGrow: 1,
    marginHorizontal: 4,
  },
  // Table
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1.5,
    borderBottomColor: colors.ink,
    backgroundColor: colors.faint,
  },
  th: {
    fontFamily: PDF_FONT.bold,
    fontSize: 10,
    padding: 6,
  },
  td: {
    padding: 6,
    minHeight: 28,
  },
});
