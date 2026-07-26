// ============================================================================
// Launch Sunday Checklists — react-pdf template (F6)
// ============================================================================
//
// A print-ready packet with one page per ministry team, each carrying that
// team's launch-day checklist. Covers DOC-019 (team-specific checklists).
// ============================================================================

import { Document, Page, Text, View } from "@react-pdf/renderer";

import type { DocumentMergeValues } from "../types";
import { styles } from "./styles";

const TEAMS: { team: string; items: string[] }[] = [
  {
    team: "Setup & Teardown",
    items: [
      "Arrive early; unlock and walk the venue",
      "Set out chairs, tables, and signage",
      "Stage and green room ready",
      "Trash, restrooms, and parking checked",
      "Full teardown and venue reset after service",
    ],
  },
  {
    team: "Hospitality & Welcome",
    items: [
      "Greeters in place at every entrance",
      "Welcome table stocked (info, sign-in, gifts)",
      "Coffee and refreshments ready",
      "First-time guests greeted and connected",
      "Connection cards collected",
    ],
  },
  {
    team: "Worship & Production",
    items: [
      "Sound check and mix complete",
      "Slides, lyrics, and announcements loaded",
      "Lighting and stage set",
      "Band/vocal run-through done",
      "Backup plan for tech failure ready",
    ],
  },
  {
    team: "Children's Ministry",
    items: [
      "Check-in and security system ready",
      "Rooms set, clean, and staffed (ratios met)",
      "Background-checked volunteers confirmed",
      "Curriculum, supplies, and snacks prepared",
      "Allergy and emergency procedures posted",
    ],
  },
  {
    team: "Connections & Follow-up",
    items: [
      "Next-steps / membership info ready",
      "Guest gifts prepared",
      "Follow-up plan assigned for every guest",
      "Small-group / serving sign-ups available",
      "Photos and stories captured (with consent)",
    ],
  },
  {
    team: "Prayer",
    items: [
      "Prayer team gathered before doors open",
      "Pray over the venue, team, and guests",
      "Prayer available during and after service",
      "Prayer requests collected and assigned",
    ],
  },
];

export function LaunchSundayChecklistsDocument({
  values,
}: {
  values: DocumentMergeValues;
}) {
  const churchName = values.church_name || "Our Church";
  const subtitleBase = ["Launch Sunday Checklist", values.launch_date || null]
    .filter(Boolean)
    .join("  •  ");

  return (
    <Document title="Launch Sunday Checklists">
      {TEAMS.map(({ team, items }) => (
        <Page key={team} size="LETTER" style={styles.page}>
          <Text style={styles.h1}>{churchName}</Text>
          <Text style={styles.subtitle}>
            {subtitleBase}
            {"  •  "}
            {team}
          </Text>

          <Text style={styles.h2}>{team}</Text>
          {items.map((item) => (
            <View key={item} style={styles.checkRow}>
              <View style={styles.checkbox} />
              <Text>{item}</Text>
            </View>
          ))}

          <View style={styles.divider} />
          <Text style={{ fontSize: 9, color: "#6b7280" }}>
            Team lead: ____________________ Time complete: __________
          </Text>
        </Page>
      ))}
    </Document>
  );
}
